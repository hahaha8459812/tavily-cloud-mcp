import type http from "node:http";
import { randomUUID } from "node:crypto";
import type { TavilyKeyPool } from "./keyPool.js";
import { loadConfig, saveConfig, hashPassword, type AppConfig } from "./configStore.js";

/**
 * 管理面板 API。
 * 路由约定（均需登录，除 /api/login）：
 * - POST /api/login                   登录，返回 token
 * - GET  /api/status                  面板整体状态（密钥池概览 + 面板参数）
 * - POST /api/keys                    新增密钥
 * - DELETE /api/keys?key=xxx          删除密钥
 * - POST /api/refresh-usage           刷新密钥池额度
 * - GET  /api/config                  读取面板参数
 * - PUT  /api/config                  保存面板参数
 * - POST /api/password                修改管理员密码
 */

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 登录 token 有效期 24 小时
const sessions = new Map<string, { expiresAt: number }>();

/** 简单 Bearer token 鉴权中间件 */
function isAuthorized(req: http.IncomingMessage): boolean {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const session = sessions.get(token);
  if (!session) {
    return false;
  }
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJsonBody(req: http.IncomingMessage, maxBytes = 1_048_576): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("请求体过大"));
        return;
      }
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

/**
 * 处理管理 API 请求。
 * @returns 是否已处理（true 表示已写入响应；false 表示不属于管理 API 路径）
 */
export async function handleAdminApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  keyPool: TavilyKeyPool,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (!url.pathname.startsWith("/api/")) {
    return false;
  }

  // 登录接口不鉴权
  if (url.pathname === "/api/login" && req.method === "POST") {
    try {
      const body = (await readJsonBody(req)) as { username?: string; password?: string };
      const config = loadConfig();
      const { password } = config.admin;
      // 个人项目仅校验密码；username 可选（兼容旧客户端），即使传入也忽略
      if (hashPassword(body.password ?? "") === hashPassword(password)) {
        const token = crypto.randomUUID();
        sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS });
        sendJson(res, 200, { token });
      } else {
        sendJson(res, 401, { error: "密码错误" });
      }
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "请求无效" });
    }
    return true;
  }

  if (!isAuthorized(req)) {
    sendJson(res, 401, { error: "未登录或登录已过期" });
    return true;
  }

  try {
    switch (url.pathname) {
      case "/api/status": {
        // 支持 ?refresh=1 强制刷新额度后再返回，解决面板首屏无数据需手动刷新的问题
        if (url.searchParams.get("refresh") === "1") {
          await keyPool.refreshUsage();
          persistKeys(keyPool);
        }
        const overview = keyPool.getUsageOverview();
        // 返回面板可编辑的原始配置（snake_case，与前端表单一致）
        const appConfig = loadConfig();
        sendJson(res, 200, {
          keyCount: keyPool.size,
          keys: overview.keys,
          accounts: overview.accounts,
          panelSearch: appConfig.panelSearch ?? {},
          panelExtractCrawl: appConfig.panelExtractCrawl ?? {},
        });
        return true;
      }

      case "/api/keys/token": {
        if (req.method !== "PUT") {
          sendJson(res, 405, { error: "Method not allowed" });
          return true;
        }
        const body = (await readJsonBody(req)) as { id?: string; accountToken?: string };
        if (!body.id) {
          sendJson(res, 400, { error: "缺少 id 参数" });
          return true;
        }
        const updated = keyPool.updateKeyToken(body.id, body.accountToken ?? null);
        if (!updated) {
          sendJson(res, 404, { error: "密钥不存在" });
          return true;
        }
        persistKeys(keyPool);
        sendJson(res, 200, { ok: true });
        return true;
      }

      case "/api/keys": {
        if (req.method === "POST") {
          const body = (await readJsonBody(req)) as { apiKey?: string; accountToken?: string };
          if (!body.apiKey) {
            sendJson(res, 400, { error: "缺少 apiKey 参数" });
            return true;
          }
          const added = keyPool.addKey(body.apiKey.trim(), body.accountToken ?? null);
          if (!added) {
            sendJson(res, 400, { error: "密钥无效或已存在" });
            return true;
          }
          persistKeys(keyPool);
          sendJson(res, 200, { ok: true, keyCount: keyPool.size });
        } else if (req.method === "DELETE") {
          // 用密钥指纹 id 删除，避免明文密钥出现在面板请求中
          const keyId = url.searchParams.get("id") ?? "";
          const removed = keyPool.removeKeyById(keyId);
          if (!removed) {
            sendJson(res, 404, { error: "密钥不存在" });
            return true;
          }
          persistKeys(keyPool);
          sendJson(res, 200, { ok: true, keyCount: keyPool.size });
        } else {
          sendJson(res, 405, { error: "Method not allowed" });
        }
        return true;
      }

      case "/api/refresh-usage": {
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "Method not allowed" });
          return true;
        }
        await keyPool.refreshUsage();
        persistKeys(keyPool);
        const overview = keyPool.getUsageOverview();
        sendJson(res, 200, { ok: true, keys: overview.keys, accounts: overview.accounts });
        return true;
      }

      case "/api/config": {
        if (req.method === "GET") {
          const appConfig = loadConfig();
          sendJson(res, 200, {
            panelSearch: appConfig.panelSearch ?? {},
            panelExtractCrawl: appConfig.panelExtractCrawl ?? {},
          });
          return true;
        }
        if (req.method === "PUT") {
          const body = (await readJsonBody(req)) as {
            panelSearch?: Record<string, unknown>;
            panelExtractCrawl?: Record<string, unknown>;
          };
          const config = loadConfig();
          if (body.panelSearch !== undefined) {
            config.panelSearch = body.panelSearch;
          }
          if (body.panelExtractCrawl !== undefined) {
            config.panelExtractCrawl = body.panelExtractCrawl;
          }
          saveConfig(config);
          sendJson(res, 200, { ok: true });
          return true;
        }
        sendJson(res, 405, { error: "Method not allowed" });
        return true;
      }

      case "/api/password": {
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "Method not allowed" });
          return true;
        }
        const body = (await readJsonBody(req)) as {
          oldPassword?: string;
          newPassword?: string;
        };
        const config = loadConfig();
        if (hashPassword(body.oldPassword ?? "") !== hashPassword(config.admin.password)) {
          sendJson(res, 401, { error: "原密码错误" });
          return true;
        }
        if (!body.newPassword || body.newPassword.length < 6) {
          sendJson(res, 400, { error: "新密码至少 6 位" });
          return true;
        }
        config.admin.password = body.newPassword;
        saveConfig(config);
        sendJson(res, 200, { ok: true });
        return true;
      }

      default:
        sendJson(res, 404, { error: "接口不存在" });
        return true;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { error: message });
    return true;
  }
}

/** 将当前密钥池同步回 config.json，保证面板增删密钥与 token 持久化 */
export function persistKeys(keyPool: TavilyKeyPool): void {
  const config = loadConfig() as AppConfig & { apiKeys?: unknown };
  // null token 转为 undefined，避免 config.json 中出现冗余 null
  config.apiKeys = keyPool
    .getRawKeyEntries()
    .map(({ key, accountToken }) => ({ key, ...(accountToken ? { accountToken } : {}) }));
  saveConfig(config);
}
