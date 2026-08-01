import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  delay,
  waitForServer,
  startServerProcess,
  stopServerProcess,
  callToolAndParse,
} from "./test-utils.js";

async function main() {
  const serverProcess = startServerProcess();
  let client: Client | null = null;

  try {
    const healthUrl = "http://127.0.0.1:8080/health";
    const serverReady = await waitForServer(healthUrl, 15000);
    if (!serverReady) {
      throw new Error("服务器未在 15 秒内就绪");
    }
    console.log("[OK] 服务器已就绪");

    const transport = new StreamableHTTPClientTransport(
      new URL("http://127.0.0.1:8080/mcp"),
    );
    client = new Client(
      { name: "tavily-mcp-integration-test", version: "0.0.1" },
      { capabilities: {} },
    );

    await client.connect(transport);
    const toolsResult = await client.listTools();
    console.log(`[OK] tools/list 返回 ${toolsResult.tools.length} 个工具`);
    for (const tool of toolsResult.tools) {
      console.log(`  - ${tool.name}: ${tool.description}`);
    }

    const webSearchTool = toolsResult.tools.find((tool) => tool.name === "web_search");
    if (!webSearchTool) {
      throw new Error("未找到 web_search 工具");
    }
    const usageTool = toolsResult.tools.find((tool) => tool.name === "get_key_usage");
    if (!usageTool) {
      throw new Error("未找到 get_key_usage 工具");
    }

    console.log("[OK] 调用 web_search 真实搜索 (query=latest AI news)...");
    const payload = (await callToolAndParse(client, "web_search", {
      query: "latest AI news",
      max_results: 3,
    })) as {
      results?: unknown[];
      answer?: unknown;
    };
    const searchResults = Array.isArray(payload.results) ? payload.results : [];
    console.log(`[OK] 搜索返回 ${searchResults.length} 条结果`);
    if (searchResults.length > 0) {
      const first = searchResults[0] as { title: string; url: string };
      console.log(`  首条结果标题: ${first.title}`);
      console.log(`  首条结果链接: ${first.url}`);
    }

    console.log("[OK] 调用 get_key_usage 查询密钥池额度...");
    const usagePayload = (await callToolAndParse(client, "get_key_usage", {})) as {
      keyCount: number;
      keys: Array<{
        apiKeyMasked: string;
        health: string;
        keyUsage: number;
        keyLimit: number | null;
        keyRemaining: number | null;
        planUsage: number;
        planLimit: number;
      }>;
    };
    console.log(`[OK] 密钥池共 ${usagePayload.keyCount} 个密钥，额度概览：`);
    for (const key of usagePayload.keys) {
      console.log(
        `  - ${key.apiKeyMasked} 健康状态=${key.health} key 用量=${key.keyUsage}/${key.keyLimit ?? "∞"} 剩余=${key.keyRemaining ?? "∞"} plan=${key.planUsage}/${key.planLimit}`,
      );
    }

    console.log("[OK] 全部断言通过，测试完成");
  } catch (error) {
    console.error("[FAIL]", error);
    process.exitCode = 1;
  } finally {
    if (client) {
      await client.close().catch(() => {
        /* 关闭失败不阻断进程清理 */
      });
    }
    await stopServerProcess(serverProcess);
    // 留出时间让服务器退出，避免端口未释放
    await delay(500);
  }
}

void main();
