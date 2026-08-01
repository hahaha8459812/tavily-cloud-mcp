import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { delay, waitForServer } from "./test-utils.js";

/**
 * 针对运行中的 Docker 容器（http://127.0.0.1:8080）做全 7 个 MCP 工具的真实调用测试。
 * 覆盖：web_search / web_extract / web_crawl / web_map / research_create / research_get_status / get_key_usage
 * 前提：本地容器已启动（docker compose up -d），面板密码未开启 MCP 鉴权。
 */
const BASE_URL = "http://127.0.0.1:8080/mcp";

async function main() {
  let client: Client | null = null;

  try {
    const healthUrl = "http://127.0.0.1:8080/health";
    if (!(await waitForServer(healthUrl, 10000))) {
      throw new Error("服务器未就绪，请先 docker compose up -d");
    }

    const transport = new StreamableHTTPClientTransport(new URL(BASE_URL));
    client = new Client({ name: "tavily-full-tools-test", version: "0.0.1" }, { capabilities: {} });
    await client.connect(transport);
    console.log("[OK] MCP 连接成功");
    console.log(`[OK] 工具列表: ${(await client.listTools()).tools.map((t) => t.name).join(", ")}\n`);

    // ---------- 1. web_search ----------
    console.log("[1/7] web_search 测试...");
    {
      const raw = await client.callTool({
        name: "web_search",
        arguments: { query: "Claude AI latest release", max_results: 3, search_depth: "basic" },
      });
      const text = raw.content.filter((i) => i.type === "text").map((i) => (i as { text: string }).text).join("\n");
      const result = JSON.parse(text);
      if (!Array.isArray(result.results) || result.results.length === 0) {
        throw new Error("web_search 未返回结果");
      }
      const first = result.results[0] as { title?: string; url?: string };
      console.log(`[OK] 返回 ${result.results.length} 条，首条: "${first.title}" (${first.url})`);
    }

    // ---------- 2. web_extract ----------
    console.log("\n[2/7] web_extract 测试...");
    {
      const raw = await client.callTool({
        name: "web_extract",
        arguments: { urls: "https://en.wikipedia.org/wiki/Artificial_intelligence" },
      });
      const text = raw.content.filter((i) => i.type === "text").map((i) => (i as { text: string }).text).join("\n");
      const result = JSON.parse(text);
      const results = Array.isArray(result.results) ? result.results : [];
      if (results.length === 0) {
        throw new Error("web_extract 未返回任何结果");
      }
      const first = results[0] as { url?: string; raw_content?: string };
      console.log(`[OK] 返回 ${results.length} 条，首条 URL: ${first.url}`);
      console.log(`      raw_content 前 60 字符: ${String(first.raw_content ?? "").slice(0, 60)}...`);
    }

    // ---------- 3. web_crawl ----------
    console.log("\n[3/7] web_crawl 测试...");
    {
      const raw = await client.callTool({
        name: "web_crawl",
        arguments: { url: "https://docs.tavily.com", max_depth: 1, limit: 3 },
      });
      const text = raw.content.filter((i) => i.type === "text").map((i) => (i as { text: string }).text).join("\n");
      const result = JSON.parse(text);
      if (!Array.isArray(result.results) || result.results.length === 0) {
        throw new Error(`web_crawl 未返回结果，响应: ${text.slice(0, 200)}`);
      }
      console.log(`[OK] base_url: ${result.base_url}，抓取 ${result.results.length} 页`);
    }

    // ---------- 4. web_map ----------
    console.log("\n[4/7] web_map 测试...");
    {
      const raw = await client.callTool({
        name: "web_map",
        arguments: { url: "docs.tavily.com", max_depth: 1, limit: 5 },
      });
      const text = raw.content.filter((i) => i.type === "text").map((i) => (i as { text: string }).text).join("\n");
      const result = JSON.parse(text);
      const urls = Array.isArray(result.results) ? result.results : [];
      if (urls.length === 0) {
        throw new Error(`web_map 未返回任何 URL，响应: ${text.slice(0, 200)}`);
      }
      console.log(`[OK] 返回 ${urls.length} 个 URL，前 3: ${urls.slice(0, 3).join(", ")}`);
    }

    // ---------- 5. research_create ----------
    console.log("\n[5/7] research_create 测试...");
    let requestId = "";
    {
      const raw = await client.callTool({
        name: "research_create",
        arguments: { input: "What are the latest developments in AI?", model: "mini", output_length: "short" },
      });
      const text = raw.content.filter((i) => i.type === "text").map((i) => (i as { text: string }).text).join("\n");
      const result = JSON.parse(text);
      if (!result.request_id) {
        throw new Error(`research_create 未返回 request_id，响应: ${text.slice(0, 200)}`);
      }
      requestId = result.request_id;
      console.log(`[OK] request_id: ${requestId}, status: ${result.status}`);
    }

    // ---------- 6. research_get_status（轮询） ----------
    console.log("\n[6/7] research_get_status 测试（轮询）...");
    {
      const pollTimeoutMs = 90_000;
      const pollStartedAt = Date.now();
      let completed = false;
      while (Date.now() - pollStartedAt < pollTimeoutMs) {
        await delay(5000);
        const raw = await client.callTool({
          name: "research_get_status",
          arguments: { request_id: requestId },
        });
        const text = raw.content.filter((i) => i.type === "text").map((i) => (i as { text: string }).text).join("\n");
        const result = JSON.parse(text);
        console.log(`      轮询: status=${result.status}`);
        if (result.status === "completed") {
          console.log(`[OK] 报告完成，内容前 100 字符: ${String(result.content ?? "").slice(0, 100)}...`);
          if (Array.isArray(result.sources)) {
            console.log(`      引用来源 ${result.sources.length} 个`);
          }
          completed = true;
          break;
        }
        if (result.status === "failed") {
          throw new Error("研究任务失败");
        }
      }
      if (!completed) {
        throw new Error("研究任务在 90 秒内未完成");
      }
    }

    // ---------- 7. get_key_usage ----------
    console.log("\n[7/7] get_key_usage 测试...");
    {
      const raw = await client.callTool({ name: "get_key_usage", arguments: {} });
      const text = raw.content.filter((i) => i.type === "text").map((i) => (i as { text: string }).text).join("\n");
      const result = JSON.parse(text);
      if (typeof result.keyCount !== "number") {
        throw new Error("get_key_usage 缺少 keyCount");
      }
      console.log(`[OK] 密钥数: ${result.keyCount}`);
      for (const key of result.keys as Array<{ apiKeyMasked: string; health: string; email?: string | null; keyUsage?: number | null }>) {
        console.log(`      脱敏: ${key.apiKeyMasked} | 状态: ${key.health} | 邮箱: ${key.email ?? "—"} | 已用: ${key.keyUsage ?? "—"}`);
      }
    }

    console.log("\n[通过] 全部 7 个工具测试完成");
  } catch (error) {
    console.error("\n[FAIL]", error);
    process.exitCode = 1;
  } finally {
    if (client) {
      await client.close().catch(() => {
        /* 关闭失败不阻断清理 */
      });
    }
  }
}

void main();
