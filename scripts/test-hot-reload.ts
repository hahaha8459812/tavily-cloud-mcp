import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  delay,
  waitForServer,
  startServerProcess,
  stopServerProcess,
  callToolAndParse,
} from "./test-utils.js";

/**
 * 验证面板热修改：
 * 1. 保存面板参数（include_favicon=true）后，下一次 web_search 立即生效
 * 2. 参数会持久化到 config.json
 */
async function main() {
  const serverProcess = startServerProcess();
  let client: Client | null = null;

  try {
    const healthUrl = "http://127.0.0.1:8080/health";
    if (!(await waitForServer(healthUrl, 15000))) {
      throw new Error("服务器未就绪");
    }

    // 登录面板
    const loginResp = await fetch("http://127.0.0.1:8080/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin123" }),
    });
    const loginBody = (await loginResp.json()) as { token?: string };
    if (!loginBody.token) {
      throw new Error("面板登录失败");
    }
    const authHeaders = {
      Authorization: `Bearer ${loginBody.token}`,
      "Content-Type": "application/json",
    };
    console.log("[OK] 面板登录成功");

    // 先查询一次当前面板参数
    const configResp = await fetch("http://127.0.0.1:8080/api/config", {
      headers: authHeaders,
    });
    const configBefore = (await configResp.json()) as {
      panelSearch?: Record<string, unknown>;
    };
    console.log(`[OK] 保存前面板参数: ${JSON.stringify(configBefore.panelSearch)}`);

    // 通过面板保存 include_favicon=true
    const saveResp = await fetch("http://127.0.0.1:8080/api/config", {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({
        panelSearch: { include_favicon: true },
      }),
    });
    if (!saveResp.ok) {
      throw new Error(`保存面板参数失败: ${saveResp.status}`);
    }
    console.log("[OK] 已保存 include_favicon=true");

    // 立即用 MCP 客户端调用 web_search，验证新参数生效
    const transport = new StreamableHTTPClientTransport(
      new URL("http://127.0.0.1:8080/mcp"),
    );
    client = new Client(
      { name: "tavily-hot-reload-test", version: "0.0.1" },
      { capabilities: {} },
    );
    await client.connect(transport);

    const payload = (await callToolAndParse(client, "web_search", {
      query: "Tavily",
      max_results: 3,
    })) as { results?: Array<{ favicon?: unknown }> };

    const hasFavicon = payload.results?.some((r) => r.favicon !== undefined && r.favicon !== null);
    console.log(`[OK] 搜索结果第一条 favicon 字段存在: ${hasFavicon === true}`);
    if (hasFavicon !== true) {
      throw new Error("include_favicon=true 未生效，搜索结果无 favicon 字段");
    }
    console.log("[通过] 面板热修改生效：保存参数后无需重启，下一次调用立即使用新参数");

    // 清理：恢复原参数（清空 panelSearch）
    await fetch("http://127.0.0.1:8080/api/config", {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({ panelSearch: {} }),
    });
    console.log("[OK] 已恢复默认参数");
  } catch (error) {
    console.error("[FAIL]", error);
    process.exitCode = 1;
  } finally {
    if (client) {
      await client.close().catch(() => {});
    }
    await stopServerProcess(serverProcess);
    await delay(500);
  }
}

void main();
