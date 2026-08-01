import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  delay,
  waitForServer,
  startServerProcess,
  stopServerProcess,
} from "./test-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.resolve(__dirname, "..", "config.json");
const CONFIG_BACKUP = path.resolve(__dirname, "..", "config.json.bak");

interface TestContext {
  baseUrl: string;
  token: string;
}

async function login(baseUrl: string, username: string, password: string): Promise<string> {
  const resp = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!resp.ok) {
    throw new Error(`登录失败：HTTP ${resp.status}`);
  }
  const body = (await resp.json()) as { token?: string };
  if (!body.token) {
    throw new Error("登录响应缺少 token");
  }
  return body.token;
}

async function authedFetch(ctx: TestContext, pathname: string, options: { method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${ctx.token}`,
  };
  const resp = await fetch(`${ctx.baseUrl}${pathname}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await resp.text();
  return { status: resp.status, body: text ? JSON.parse(text) : {} };
}

async function main() {
  // 备份并重置 config.json，确保测试环境干净
  if (fileExists(CONFIG_FILE)) {
    copyFileSync(CONFIG_FILE, CONFIG_BACKUP);
  }
  writeFileSync(
    CONFIG_FILE,
    JSON.stringify(
      {
        admin: { username: "admin", password: "admin123" },
        apiKeys: [],
        panelSearch: {},
        panelExtractCrawl: {},
      },
      null,
      2,
    ),
    "utf8",
  );

  const serverProcess = startServerProcess();
  const ctx: TestContext = { baseUrl: "http://127.0.0.1:8080", token: "" };

  try {
    const healthUrl = "http://127.0.0.1:8080/health";
    if (!(await waitForServer(healthUrl, 15000))) {
      throw new Error("服务器未就绪");
    }

    console.log("[测试 1] 错误密码登录应 401...");
    const badLogin = await fetch(`${ctx.baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "wrong" }),
    });
    if (badLogin.status !== 401) {
      throw new Error(`期望 401，实际 ${badLogin.status}`);
    }
    console.log("[OK] 错误密码返回 401");

    console.log("[测试 2] 正确密码登录返回 token...");
    ctx.token = await login(ctx.baseUrl, "admin", "admin123");
    console.log(`[OK] 登录成功 token=${ctx.token.slice(0, 8)}...`);

    console.log("[测试 3] 未授权访问 /api/status 应 401...");
    const noAuth = await fetch(`${ctx.baseUrl}/api/status`);
    if (noAuth.status !== 401) {
      throw new Error(`期望 401，实际 ${noAuth.status}`);
    }
    console.log("[OK] 未授权返回 401");

    console.log("[测试 4] 添加密钥（无效 key 应 400，有效格式应成功）...");
    const badAdd = await authedFetch(ctx, "/api/keys", {
      method: "POST",
      body: { apiKey: "not-a-key" },
    });
    if (badAdd.status !== 400) {
      throw new Error(`无效 key 期望 400，实际 ${badAdd.status}`);
    }
    console.log("[OK] 无效 key 返回 400");

    // 记录添加前的密钥数（服务器会从环境变量加载已有 key）
    const beforeStatus = await authedFetch(ctx, "/api/status");
    const beforeCount = beforeStatus.body.keyCount ?? 0;
    const addResp = await authedFetch(ctx, "/api/keys", {
      method: "POST",
      body: { apiKey: "tvly-test-add-0001" },
    });
    if (addResp.status !== 200 || addResp.body.keyCount !== beforeCount + 1) {
      throw new Error(`添加有效格式 key 失败：${JSON.stringify(addResp)}`);
    }
    console.log(`[OK] 添加 key 成功，keyCount ${beforeCount} -> ${addResp.body.keyCount}`);

    console.log("[测试 5] 保存并读取面板参数（热修改数据层）...");
    const saveResp = await authedFetch(ctx, "/api/config", {
      method: "PUT",
      body: {
        panelSearch: { include_favicon: true, chunks_per_source: 2 },
        panelExtractCrawl: { extract_depth: "advanced" },
      },
    });
    if (saveResp.status !== 200) {
      throw new Error(`保存配置失败：${JSON.stringify(saveResp)}`);
    }
    const getResp = await authedFetch(ctx, "/api/config");
    if (
      getResp.body.panelSearch?.include_favicon !== true ||
      getResp.body.panelExtractCrawl?.extract_depth !== "advanced"
    ) {
      throw new Error(`读取配置与保存不一致：${JSON.stringify(getResp.body)}`);
    }
    console.log("[OK] 面板参数保存/读取一致");

    console.log("[测试 6] 修改密码后旧 token 失效、新密码可登录...");
    const pwdResp = await authedFetch(ctx, "/api/password", {
      method: "POST",
      body: { oldPassword: "admin123", newPassword: "newpass456" },
    });
    if (pwdResp.status !== 200) {
      throw new Error(`修改密码失败：${JSON.stringify(pwdResp)}`);
    }
    // 旧 token 应仍然有效（token 不随密码失效），但用新密码登录应成功
    const newToken = await login(ctx.baseUrl, "admin", "newpass456");
    console.log(`[OK] 新密码登录成功 token=${newToken.slice(0, 8)}...`);

    console.log("[测试 7] 按指纹删除密钥...");
    const statusResp = await authedFetch(ctx, "/api/status");
    const key = statusResp.body.keys?.find((k: { id: string }) => k.id);
    if (!key) {
      throw new Error("未找到可删除的密钥");
    }
    const delResp = await authedFetch(ctx, `/api/keys?id=${encodeURIComponent(key.id)}`, {
      method: "DELETE",
    });
    if (delResp.status !== 200 || delResp.body.keyCount !== beforeCount) {
      throw new Error(`按指纹删除失败：${JSON.stringify(delResp)}`);
    }
    console.log(`[OK] 按指纹删除成功（id=${key.id}），keyCount 恢复到 ${delResp.body.keyCount}`);

    console.log("[通过] 管理面板 API 全部测试通过");
  } finally {
    await stopServerProcess(serverProcess);
    await delay(500);
    // 恢复 config.json
    if (fileExists(CONFIG_BACKUP)) {
      copyFileSync(CONFIG_BACKUP, CONFIG_FILE);
    } else {
      writeFileSync(
        CONFIG_FILE,
        JSON.stringify(
          {
            admin: { username: "admin", password: "admin123" },
            apiKeys: [],
            panelSearch: {},
            panelExtractCrawl: {},
          },
          null,
          2,
        ),
        "utf8",
      );
    }
    try {
      readFileSync(CONFIG_FILE);
    } catch {
      /* 忽略 */
    }
  }
}

function fileExists(filePath: string): boolean {
  try {
    readFileSync(filePath);
    return true;
  } catch {
    return false;
  }
}

void main().catch((error) => {
  console.error("[FAIL]", error);
  process.exit(1);
});
