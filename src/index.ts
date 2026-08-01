import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { TavilyKeyPool } from "./keyPool.js";
import {
  loadPanelSearchConfig,
  applyPanelSearchConfig,
  loadPanelExtractCrawlConfig,
  applyPanelExtractConfig,
  applyPanelCrawlConfig,
  loadTavilyApiKeyEntries,
} from "./config.js";
import { handleAdminApi, persistKeys } from "./adminApi.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RAW_PORT = Number(process.env.PORT ?? 8080);
if (!Number.isInteger(RAW_PORT) || RAW_PORT <= 0 || RAW_PORT > 65535) {
  console.error(`无效的 PORT 配置：${process.env.PORT}`);
  process.exit(1);
}
const PORT = RAW_PORT;

// MCP 通道共享鉴权 token（H1）：云端对外暴露时设置，保护 Tavily 额度；
// 未设置则不启用 MCP 鉴权（默认兼容）
const MCP_API_KEY = process.env.MCP_API_KEY ?? "";

/** 会话 ID 脱敏（L2）：日志仅保留前 8 位，避免会话标识被日志聚合滥用 */
function maskSessionId(sessionId: string): string {
  return sessionId.length > 8 ? `${sessionId.slice(0, 8)}…` : sessionId;
}

// 会话管理常量
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 会话空闲 30 分钟回收
const SESSION_SCAN_INTERVAL_MS = 5 * 60 * 1000; // 每 5 分钟扫描一次过期会话
const MAX_ACTIVE_SESSIONS = 100; // 并发会话上限，防止内存无限膨胀
const MAX_BODY_BYTES = 1024 * 1024; // 请求体上限 1MB

// 多密钥轮询池：支持多 API Key 轮询 + 429/401 故障转移 + 官网 token 实时额度
const keyPool = new TavilyKeyPool(loadTavilyApiKeyEntries());

// 启动后异步预热各密钥额度缓存，保证管理面板首屏即可显示真实额度，无需手动刷新
void keyPool.refreshUsage().catch((error) => {
  console.error("启动预热额度缓存失败：", error instanceof Error ? error.message : error);
});

// 自动续期：每 6 小时用现有 appSession token 调官网接口，捕获 Set-Cookie 续期并持久化
const ACCOUNT_TOKEN_RENEW_INTERVAL_MS = 6 * 60 * 60 * 1000;
setInterval(() => {
  void (async () => {
    await keyPool.refreshUsage();
    persistKeys(keyPool);
  })().catch((error) => {
    console.error("额度自动续期失败：", error instanceof Error ? error.message : error);
  });
}, ACCOUNT_TOKEN_RENEW_INTERVAL_MS);

/** 输出统一的错误响应 */
function errorResult(message: string): {
  content: { type: "text"; text: string }[];
  isError: boolean;
} {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

/**
 * 创建 MCP Server 实例。
 * 每个新会话都需要独立的实例，因为 Protocol.connect 一次只能连接一个 transport。
 */
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "tavily-cloud-mcp",
    version: "0.1.0",
  });

  server.registerTool(
    "web_search",
    {
      description: "使用 Tavily 进行实时网络搜索",
      inputSchema: {
        query: z.string().describe("搜索关键词"),
        max_results: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(5)
          .describe("返回结果数量，默认 5，最大 20"),
        search_depth: z
          .enum(["advanced", "basic", "fast", "ultra-fast"])
          .default("basic")
          .describe("搜索深度：advanced 质量最高但更慢更贵，ultra-fast 最快最省"),
        topic: z
          .enum(["general", "news", "finance"])
          .optional()
          .describe("搜索类别：general 通用，news 新闻，finance 金融"),
        time_range: z
          .enum(["day", "week", "month", "year", "d", "w", "m", "y"])
          .optional()
          .describe("按发布日期/更新时间回溯过滤结果的时间范围"),
        start_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("返回该日期之后的结果，格式 YYYY-MM-DD"),
        end_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("返回该日期之前的结果，格式 YYYY-MM-DD"),
        exact_match: z
          .boolean()
          .optional()
          .describe("只返回包含查询中精确短语的结果（短语需加引号）"),
      },
    },
    async ({ query, max_results, search_depth, topic, time_range, start_date, end_date, exact_match }) => {
      if (!query) {
        return errorResult("错误：query 参数不能为空");
      }

      try {
        const aiParams = {
          query,
          maxResults: max_results,
          searchDepth: search_depth,
          topic,
          timeRange: time_range,
          startDate: start_date,
          endDate: end_date,
          exactMatch: exact_match,
        };

        // 每次调用时实时读取面板配置，保证面板热修改即时生效
        const mergedParams = applyPanelSearchConfig(
          aiParams,
          loadPanelSearchConfig(),
        );
        const result = await keyPool.search(mergedParams);

        const payload: Record<string, unknown> = {
          results: result.results,
        };
        if (result.answer !== undefined) {
          payload.answer = result.answer;
        }
        if (result.images !== undefined) {
          payload.images = result.images;
        }
        if (result.usage !== undefined) {
          payload.usage = result.usage;
        }

        return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(`搜索失败：${message}`);
      }
    },
  );

  server.registerTool(
    "web_extract",
    {
      description: "从指定的一个或多个 URL 提取网页内容",
      inputSchema: {
        urls: z
          .union([z.string(), z.array(z.string())])
          .describe("要提取的 URL，可传单个字符串或 URL 数组"),
        query: z
          .string()
          .optional()
          .describe("提取意图描述，用于对内容块按相关性重排"),
        chunks_per_source: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe("每个来源返回的内容片段数（需同时提供 query），1-5"),
        extract_depth: z
          .enum(["basic", "advanced"])
          .optional()
          .describe("提取深度：advanced 获取更完整数据（含表格），更慢"),
        timeout: z
          .number()
          .min(1)
          .max(60)
          .optional()
          .describe("单次提取超时秒数，1-60"),
      },
    },
    async ({ urls, query, chunks_per_source, extract_depth, timeout }) => {
      if (!urls) {
        return errorResult("错误：urls 参数不能为空");
      }

      // chunks_per_source 仅在提供 query 时对 API 有效
      if (chunks_per_source !== undefined && query === undefined) {
        return errorResult("错误：chunks_per_source 需要同时提供 query 参数");
      }

      try {
        const aiParams = {
          urls,
          query,
          chunksPerSource: chunks_per_source,
          extractDepth: extract_depth,
          timeout,
        };
        const mergedParams = applyPanelExtractConfig(
          aiParams,
          loadPanelExtractCrawlConfig(),
        );
        const result = await keyPool.extract(mergedParams);

        const payload: Record<string, unknown> = {
          results: result.results,
          failed_results: result.failed_results,
        };
        if (result.usage !== undefined) {
          payload.usage = result.usage;
        }

        return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(`提取失败：${message}`);
      }
    },
  );

  server.registerTool(
    "web_crawl",
    {
      description: "从起始 URL 开始遍历网站，抓取多个页面的内容",
      inputSchema: {
        url: z.string().describe("爬取的起始根 URL"),
        instructions: z
          .string()
          .optional()
          .describe("自然语言爬取指令，如「找到所有 Python SDK 相关页面」"),
        max_depth: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe("爬取最大深度，1-5"),
        max_breadth: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("每层最多跟随的链接数，1-500"),
        limit: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("处理链接总数上限"),
        select_paths: z
          .array(z.string())
          .optional()
          .describe("仅匹配这些正则路径，如 /docs/.*"),
        select_domains: z
          .array(z.string())
          .optional()
          .describe("仅爬取这些正则域名，如 ^docs\\\\.example\\\\.com$"),
        exclude_paths: z
          .array(z.string())
          .optional()
          .describe("排除这些正则路径，如 /private/.*"),
        exclude_domains: z
          .array(z.string())
          .optional()
          .describe("排除这些正则域名"),
        allow_external: z
          .boolean()
          .optional()
          .describe("是否在结果中包含外部域名链接"),
        timeout: z
          .number()
          .min(10)
          .max(150)
          .optional()
          .describe("爬取操作超时秒数，10-150"),
      },
    },
    async (args) => {
      if (!args.url) {
        return errorResult("错误：url 参数不能为空");
      }

      try {
        const aiParams = {
          url: args.url,
          instructions: args.instructions,
          maxDepth: args.max_depth,
          maxBreadth: args.max_breadth,
          limit: args.limit,
          selectPaths: args.select_paths,
          selectDomains: args.select_domains,
          excludePaths: args.exclude_paths,
          excludeDomains: args.exclude_domains,
          allowExternal: args.allow_external,
          timeout: args.timeout,
        };
        const mergedParams = applyPanelCrawlConfig(
          aiParams,
          loadPanelExtractCrawlConfig(),
        );
        const result = await keyPool.crawl(mergedParams);

        const payload: Record<string, unknown> = {
          base_url: result.base_url,
          results: result.results,
        };
        if (result.usage !== undefined) {
          payload.usage = result.usage;
        }

        return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(`爬取失败：${message}`);
      }
    },
  );

  server.registerTool(
    "web_map",
    {
      description: "像图一样遍历网站，生成站点 URL 地图",
      inputSchema: {
        url: z.string().describe("站点地图的起始根 URL"),
        instructions: z
          .string()
          .optional()
          .describe("自然语言映射指令，如「找到所有关于 Python SDK 的页面」"),
        max_depth: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe("映射最大深度，1-5"),
        max_breadth: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("每层最多跟随的链接数，1-500"),
        limit: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("处理链接总数上限"),
        select_paths: z
          .array(z.string())
          .optional()
          .describe("仅匹配这些正则路径"),
        select_domains: z
          .array(z.string())
          .optional()
          .describe("仅映射这些正则域名"),
        exclude_paths: z
          .array(z.string())
          .optional()
          .describe("排除这些正则路径"),
        exclude_domains: z
          .array(z.string())
          .optional()
          .describe("排除这些正则域名"),
        allow_external: z
          .boolean()
          .optional()
          .describe("是否包含外部域名链接"),
        timeout: z
          .number()
          .min(10)
          .max(150)
          .optional()
          .describe("映射操作超时秒数，10-150"),
      },
    },
    async (args) => {
      if (!args.url) {
        return errorResult("错误：url 参数不能为空");
      }

      try {
        const aiParams = {
          url: args.url,
          instructions: args.instructions,
          maxDepth: args.max_depth,
          maxBreadth: args.max_breadth,
          limit: args.limit,
          selectPaths: args.select_paths,
          selectDomains: args.select_domains,
          excludePaths: args.exclude_paths,
          excludeDomains: args.exclude_domains,
          allowExternal: args.allow_external,
          timeout: args.timeout,
        };
        // Map API 不支持 extract/crawl 的输出偏好参数（includeImages/format 等），
        // 因此这里不套用面板提取配置，参数与 Tavily /map 端点一一对应
        const result = await keyPool.map(aiParams);

        const payload: Record<string, unknown> = {
          base_url: result.base_url,
          results: result.results,
        };
        if (result.usage !== undefined) {
          payload.usage = result.usage;
        }

        return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(`站点地图生成失败：${message}`);
      }
    },
  );

  server.registerTool(
    "research_create",
    {
      description: "创建 Tavily 深度研究任务，返回 request_id（需用 research_get_status 轮询结果）",
      inputSchema: {
        input: z.string().describe("要研究的主题或问题"),
        model: z
          .enum(["mini", "pro", "auto"])
          .optional()
          .describe("研究模型：mini 轻量快速，pro 全面深入，auto 自动选择"),
        citation_format: z
          .enum(["numbered", "mla", "apa", "chicago"])
          .optional()
          .describe("引用格式"),
        output_length: z
          .enum(["short", "standard", "long"])
          .optional()
          .describe("报告长度"),
        include_domains: z
          .array(z.string())
          .max(20)
          .optional()
          .describe("优先使用的来源域名"),
        exclude_domains: z
          .array(z.string())
          .max(20)
          .optional()
          .describe("排除的来源域名"),
      },
    },
    async (args) => {
      if (!args.input) {
        return errorResult("错误：input 参数不能为空");
      }

      try {
        const aiParams = {
          input: args.input,
          model: args.model,
          citationFormat: args.citation_format,
          outputLength: args.output_length,
          includeDomains: args.include_domains,
          excludeDomains: args.exclude_domains,
        };
        const result = await keyPool.createResearch(aiParams);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(`创建研究任务失败：${message}`);
      }
    },
  );

  server.registerTool(
    "research_get_status",
    {
      description: "查询研究任务状态与结果（status=completed 时返回报告）",
      inputSchema: {
        request_id: z.string().describe("research_create 返回的任务 ID"),
      },
    },
    async ({ request_id }) => {
      if (!request_id) {
        return errorResult("错误：request_id 参数不能为空");
      }

      try {
        const result = await keyPool.getResearchStatus(request_id);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(`查询研究任务失败：${message}`);
      }
    },
  );

  server.registerTool(
    "get_key_usage",
    {
      description: "查询密钥池中所有 Tavily API Key 的额度使用情况（脱敏展示）",
      inputSchema: {},
    },
    async () => {
      try {
        // 先刷新各密钥额度状态，再返回概览
        await keyPool.refreshUsage();
        const overview = keyPool.getUsageOverview();

        const payload = {
          keyCount: keyPool.size,
          keys: overview.keys,
          accounts: overview.accounts,
          note: "apiKeyMasked 已脱敏；keyRemaining 为 null 表示该密钥额度无上限",
        };
        return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(`额度查询失败：${message}`);
      }
    },
  );

  return server;
}

// 按 sessionId 保存 transport 及其最后活跃时间，用于复用连接和空闲回收
interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  lastActiveAt: number;
}

const sessions = new Map<string, SessionEntry>();

/** 读取请求体 JSON，限制最大体积；解析失败时返回 null */
async function readJsonBody(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<unknown | null> {
  return new Promise((resolve) => {
    let body = "";
    let size = 0;
    let exceeded = false;
    let settled = false;
    const failWith400 = (message: string) => {
      if (settled) return;
      settled = true;
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
      resolve(null);
    };
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // 超限：记录标记，丢弃后续数据避免内存膨胀，正常返回 400 让客户端读到错误；
        // 慢速大包由 server.requestTimeout 兜底释放连接（见服务器创建处）
        if (!exceeded) {
          exceeded = true;
          failWith400(`请求体超过 ${MAX_BODY_BYTES} 字节上限`);
        }
        return;
      }
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      if (settled) return;
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        failWith400("Invalid JSON body");
      }
    });
    req.on("error", () => {
      failWith400("Request body read error");
    });
  });
}

/** 回收空闲超时的会话，防止内存泄漏 */
function sweepExpiredSessions(): void {
  const now = Date.now();
  for (const [sessionId, entry] of sessions) {
    if (now - entry.lastActiveAt > SESSION_IDLE_TIMEOUT_MS) {
      console.log(`会话 ${maskSessionId(sessionId)} 空闲超时，已回收`);
      sessions.delete(sessionId);
      entry.transport.close().catch((error) => {
        console.error(`关闭会话 ${maskSessionId(sessionId)} 失败：`, error);
      });
    }
  }
}

// 定期扫描回收过期会话
setInterval(sweepExpiredSessions, SESSION_SCAN_INTERVAL_MS);

function isInitializeRequest(body: unknown): boolean {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const method = (body as { method?: unknown }).method;
  return method === "initialize";
}

function touchSession(sessionId: string): void {
  const entry = sessions.get(sessionId);
  if (entry) {
    entry.lastActiveAt = Date.now();
  }
}

async function handlePost(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  // 已有会话：复用对应 transport
  if (sessionId) {
    const entry = sessions.get(sessionId);
    if (!entry) {
      // MCP Streamable HTTP 规范：未知 session 返回 404
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Session not found" }));
      return;
    }
    const body = await readJsonBody(req, res);
    if (body === null) return; // 请求体非法，已返回 400
    entry.lastActiveAt = Date.now();
    await entry.transport.handleRequest(req, res, body);
    return;
  }

  // 新会话：必须是 initialize 请求
  const body = await readJsonBody(req, res);
  if (body === null) return; // 请求体非法，已返回 400
  if (!isInitializeRequest(body)) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "No valid session ID provided" }));
    return;
  }

  // 会话上限保护
  if (sessions.size >= MAX_ACTIVE_SESSIONS) {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Session limit reached" }));
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (newSessionId) => {
      sessions.set(newSessionId, {
        transport,
        lastActiveAt: Date.now(),
      });
    },
  });
  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid && sessions.has(sid)) {
      sessions.delete(sid);
    }
  };

  const server = createMcpServer();
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

async function handleGet(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  // GET 用于 SSE 流连接，必须有有效会话
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid or missing session ID" }));
    return;
  }
  touchSession(sessionId);
  const transport = sessions.get(sessionId)!.transport;
  await transport.handleRequest(req, res);
}

async function handleDelete(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid or missing session ID" }));
    return;
  }
  touchSession(sessionId);
  const transport = sessions.get(sessionId)!.transport;
  await transport.handleRequest(req, res);
}

const ADMIN_DIST_DIR = path.resolve(__dirname, "..", "web", "dist");

/** 服务 /admin 前端静态页面 */
function serveAdminPage(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const indexPath = path.join(ADMIN_DIST_DIR, "index.html");
  if (!existsSync(indexPath)) {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "管理面板前端未构建，请先运行 npm run build:web",
      }),
    );
    return;
  }

  // 简化静态托管：仅支持 index.html 及同目录静态资源
  let filePath: string;
  if (url.pathname === "/admin" || url.pathname === "/admin/") {
    filePath = indexPath;
  } else {
    // /admin/xxx 映射到 web/dist/xxx，用 resolve + 前缀校验做标准路径穿越防护
    const relative = url.pathname.replace(/^\/admin\//, "").replace(/\\/g, "/");
    const resolved = path.resolve(ADMIN_DIST_DIR, relative);
    if (!resolved.startsWith(ADMIN_DIST_DIR + path.sep)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Forbidden" }));
      return;
    }
    filePath = resolved;
  }

  if (!existsSync(filePath)) {
    // SPA 路由回退到 index.html
    filePath = indexPath;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".json": "application/json; charset=utf-8",
    ".woff2": "font/woff2",
  };
  res.writeHead(200, { "Content-Type": contentType[ext] ?? "application/octet-stream" });
  res.end(readFileSync(filePath));
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  // 健康检查端点（供 Docker/负载均衡探针使用）
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  // 管理面板 API
  const handledApi = await handleAdminApi(req, res, keyPool);
  if (handledApi) {
    return;
  }

  // 管理面板前端静态页
  if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
    if (req.method !== "GET") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }
    serveAdminPage(req, res);
    return;
  }

  // MCP 通道鉴权（H1）：配置 MCP_API_KEY 后，MCP 请求必须携带 Authorization: Bearer <key>
  // 未配置时不鉴权（保持默认部署兼容）；用于云端对外暴露时保护 Tavily 额度
  if (MCP_API_KEY) {
    const header = req.headers.authorization ?? "";
    if (!header.startsWith("Bearer ") || header.slice(7) !== MCP_API_KEY) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "MCP 需要有效的 Authorization token" }));
      return;
    }
  }

  switch (req.method) {
    case "POST":
      await handlePost(req, res);
      return;
    case "GET":
      await handleGet(req, res);
      return;
    case "DELETE":
      await handleDelete(req, res);
      return;
    default:
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
  }
}

const server = http
  .createServer(async (req, res) => {
    try {
      await handleRequest(req, res);
    } catch (error) {
      // 内部细节只写服务端日志，对外返回通用错误文案（避免泄露内部实现）
      console.error("处理请求出错：", error);
      console.error("错误堆栈：", error instanceof Error ? error.stack : "");
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "服务器内部错误" }));
      }
    }
  });

// M4 兜底：慢速大包/挂起请求超过 60 秒未完成时由 Node 主动关闭连接，防轻量 DoS
server.requestTimeout = 60_000;
server.headersTimeout = 20_000;
server.keepAliveTimeout = 5_000;

server.listen(PORT, () => {
  console.log(`Tavily Cloud MCP server 已启动，监听端口 ${PORT}`);
});

// 优雅关闭：关闭所有活动会话（兼容 SIGINT 和 SIGTERM，Docker/K8s 停机发 SIGTERM）
async function shutdown(): Promise<void> {
  console.log("正在关闭服务器...");
  for (const sessionId of sessions.keys()) {
    try {
      await sessions.get(sessionId)!.transport.close();
    } catch (error) {
      console.error(`关闭会话 ${maskSessionId(sessionId)} 失败：`, error);
    }
  }
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
