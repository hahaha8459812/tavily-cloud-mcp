import type http from "node:http";
import type { TavilyKeyPool } from "./keyPool.js";
import {
  loadConfig,
  saveConfig,
  hashPassword,
  verifyPassword,
  isPasswordOutdated,
  type AppConfig,
} from "./configStore.js";

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
/** 管理 API 请求体大小上限 */
const MAX_BODY_BYTES = 1_048_576;

// 登录限流：同一 IP 在 15 分钟窗口内连续失败 5 次后，锁定至窗口结束（H3）
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
/** 记录每个 IP 的失败时间戳（毫秒），用于滑动窗口计数 */
const loginFailures = new Map<string, number[]>();
/** 记录每个 IP 的锁定截止时间 */
const loginLocks = new Map<string, number>();

/** 获取客户端 IP（兼容直连与常见反代头，仅用于限流） */
function getClientIp(req: http.IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]!.trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

/** 检查 IP 是否处于登录锁定状态 */
function isLoginLocked(ip: string): boolean {
  const lockedUntil = loginLocks.get(ip);
  if (lockedUntil === undefined) {
    return false;
  }
  if (Date.now() >= lockedUntil) {
    loginLocks.delete(ip);
    return false;
  }
  return true;
}

/** 记录一次登录失败：滑动窗口统计，窗口内达阈值则锁定 */
function recordLoginFailure(ip: string): void {
  const now = Date.now();
  const windowStart = now - LOGIN_LOCK_MS;
  const failures = (loginFailures.get(ip) ?? []).filter((t) => t > windowStart);
  failures.push(now);
  loginFailures.set(ip, failures);
  if (failures.length >= LOGIN_MAX_FAILURES) {
    loginLocks.set(ip, now + LOGIN_LOCK_MS);
    loginFailures.delete(ip);
  }
}

/** 登录成功后清除该 IP 的失败与锁定记录 */
function clearLoginFailures(ip: string): void {
  loginFailures.delete(ip);
  loginLocks.delete(ip);
}

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

function readJsonBody(req: http.IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        // 超限即拒绝，让客户端读到明确错误；慢速大包由 server.requestTimeout 兜底
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
      const ip = getClientIp(req);
      if (isLoginLocked(ip)) {
        sendJson(res, 429, { error: "尝试次数过多，请 15 分钟后再试" });
        return true;
      }
      const body = (await readJsonBody(req)) as { username?: string; password?: string };
      const config = loadConfig();
      const { password } = config.admin;
      // 个人项目仅校验密码；username 可选（兼容旧客户端），即使传入也忽略
      if (verifyPassword(body.password ?? "", password)) {
        clearLoginFailures(ip);
        // 旧明文/sha256 密码在此刻自动迁移为 scrypt 哈希（H6）
        if (isPasswordOutdated(password)) {
          config.admin.password = hashPassword(password);
          saveConfig(config);
        }
        const token = crypto.randomUUID();
        sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS });
        sendJson(res, 200, { token });
      } else {
        recordLoginFailure(ip);
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
          mcpAuth: appConfig.mcpAuth ?? { enabled: false, apiKey: "" },
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
            mcpAuth: appConfig.mcpAuth ?? { enabled: false, apiKey: "" },
          });
          return true;
        }
        if (req.method === "PUT") {
          const body = (await readJsonBody(req)) as {
            panelSearch?: Record<string, unknown>;
            panelExtractCrawl?: Record<string, unknown>;
            mcpAuth?: { enabled?: boolean; apiKey?: string };
          };
          const config = loadConfig();
          if (body.panelSearch !== undefined) {
            config.panelSearch = body.panelSearch;
          }
          if (body.panelExtractCrawl !== undefined) {
            config.panelExtractCrawl = body.panelExtractCrawl;
          }
          if (body.mcpAuth !== undefined) {
            const current = config.mcpAuth ?? { enabled: false, apiKey: "" };
            config.mcpAuth = {
              enabled: body.mcpAuth.enabled ?? current.enabled,
              apiKey: typeof body.mcpAuth.apiKey === "string" ? body.mcpAuth.apiKey : current.apiKey,
            };
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
        if (!verifyPassword(body.oldPassword ?? "", config.admin.password)) {
          sendJson(res, 401, { error: "原密码错误" });
          return true;
        }
        if (!body.newPassword || body.newPassword.length < 6) {
          sendJson(res, 400, { error: "新密码至少 6 位" });
          return true;
        }
        config.admin.password = hashPassword(body.newPassword);
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
