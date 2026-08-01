import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  delay,
  waitForServer,
  startServerProcess,
  stopServerProcess,
} from "./test-utils.js";

/**
 * 验证审计修复的边界行为：
 * 1. 未知 sessionId 的 POST 返回 404
 * 2. 超大请求体被拒绝
 * 3. 非法 JSON body 返回 400（而非 500）
 */
async function main() {
  const serverProcess = startServerProcess();
  let client: Client | null = null;

  try {
    const healthUrl = "http://127.0.0.1:8080/health";
    if (!(await waitForServer(healthUrl, 15000))) {
      throw new Error("服务器未就绪");
    }

    const baseUrl = "http://127.0.0.1:8080/mcp";

    // 测试 1：未知 sessionId 的 POST 应返回 404
    console.log("[测试 1] 未知 sessionId 的 POST 应返回 404...");
    const res404 = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "Mcp-Session-Id": "non-existent-session",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    if (res404.status !== 404) {
      throw new Error(`期望 404，实际 ${res404.status}`);
    }
    console.log(`[OK] 未知 sessionId 返回 404`);

    // 测试 2：非法 JSON body 应返回 400
    console.log("[测试 2] 非法 JSON body 应返回 400...");
    const res400 = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{invalid json",
    });
    if (res400.status !== 400) {
      throw new Error(`期望 400，实际 ${res400.status}`);
    }
    console.log(`[OK] 非法 JSON 返回 400`);

    // 测试 3：超大请求体应被拒绝（不返回 500）
    console.log("[测试 3] 超大请求体应被拒绝...");
    const hugeBody = JSON.stringify({ data: "x".repeat(2 * 1024 * 1024) });
    const resHuge = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: hugeBody,
    });
    if (resHuge.status === 500) {
      throw new Error("超大请求体不应返回 500");
    }
    console.log(`[OK] 超大请求体被拒绝，状态码 ${resHuge.status}`);

    // 测试 4：正常 MCP 链路仍然工作（回归确认）
    console.log("[测试 4] 正常 MCP 连接仍然工作...");
    const transport = new StreamableHTTPClientTransport(new URL(baseUrl));
    client = new Client(
      { name: "tavily-edge-test", version: "0.0.1" },
      { capabilities: {} },
    );
    await client.connect(transport);
    const toolsResult = await client.listTools();
    console.log(`[OK] 正常连接成功，tools/list 返回 ${toolsResult.tools.length} 个工具`);

    console.log("[通过] 边界行为测试全部通过");
  } catch (error) {
    console.error("[FAIL]", error);
    process.exitCode = 1;
  } finally {
    if (client) {
      await client.close().catch(() => {
        /* 忽略 */
      });
    }
    await stopServerProcess(serverProcess);
    await delay(500);
  }
}

void main();
