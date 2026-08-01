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
    if (!(await waitForServer(healthUrl, 15000))) {
      throw new Error("服务器未就绪");
    }

    const transport = new StreamableHTTPClientTransport(
      new URL("http://127.0.0.1:8080/mcp"),
    );
    client = new Client({ name: "tavily-tools-test", version: "0.0.1" }, { capabilities: {} });
    await client.connect(transport);

    console.log("[1/3] web_extract 测试 (wikipedia 页面)...");
    const extractResult = (await callToolAndParse(client, "web_extract", {
      urls: "https://en.wikipedia.org/wiki/Artificial_intelligence",
      extract_depth: "basic",
    })) as {
      results?: Array<{ url?: string; raw_content?: string }>;
      failed_results?: unknown[];
    };
    const extractResults = Array.isArray(extractResult.results) ? extractResult.results : [];
    if (extractResults.length === 0) {
      throw new Error("web_extract 未返回任何结果");
    }
    const extractFirst = extractResults[0]!;
    console.log(`[OK] extract 返回 ${extractResults.length} 条`);
    console.log(`  URL: ${extractFirst.url}`);
    console.log(`  raw_content 前 80 字符: ${String(extractFirst.raw_content ?? "").slice(0, 80)}...`);
    if (extractFirst.raw_content === undefined) {
      throw new Error("web_extract 结果缺少 raw_content 字段");
    }
    if (Array.isArray(extractResult.failed_results) && extractResult.failed_results.length > 0) {
      throw new Error(`web_extract 存在失败 URL：${JSON.stringify(extractResult.failed_results)}`);
    }

    console.log("[2/3] web_map 测试 (docs.tavily.com)...");
    const mapResult = (await callToolAndParse(client, "web_map", {
      url: "docs.tavily.com",
      max_depth: 1,
      limit: 5,
    })) as { results?: unknown[] };
    const mapUrls = Array.isArray(mapResult.results) ? mapResult.results : [];
    if (mapUrls.length === 0) {
      throw new Error("web_map 未返回任何 URL");
    }
    console.log(`[OK] map 返回 ${mapUrls.length} 个 URL`);
    console.log(`  前 3 个: ${mapUrls.slice(0, 3).join(", ")}`);

    console.log("[3/3] research_create + research_get_status 测试...");
    const researchCreated = (await callToolAndParse(client, "research_create", {
      input: "What are the latest developments in AI?",
      model: "mini",
      output_length: "short",
    })) as { request_id?: string; status?: string };
    if (!researchCreated.request_id) {
      throw new Error("research_create 未返回 request_id");
    }
    console.log(`[OK] research_create 返回 request_id: ${researchCreated.request_id}, status: ${researchCreated.status}`);
    const requestId = researchCreated.request_id;

    // 轮询研究状态（研究任务可能需要一些时间）
    const RESEARCH_POLL_TIMEOUT_MS = 60_000;
    const pollStartedAt = Date.now();
    let completed = false;
    while (Date.now() - pollStartedAt < RESEARCH_POLL_TIMEOUT_MS) {
      await delay(5000);
      const status = (await callToolAndParse(client, "research_get_status", {
        request_id: requestId,
      })) as { status?: string; content?: unknown; sources?: unknown[] };
      console.log(`  轮询: status=${status.status}`);
      if (status.status === "completed") {
        console.log(`[OK] 研究报告完成，内容前 120 字符: ${String(status.content ?? "").slice(0, 120)}...`);
        if (Array.isArray(status.sources)) {
          console.log(`  引用来源 ${status.sources.length} 个`);
        }
        completed = true;
        break;
      }
      if (status.status === "failed") {
        throw new Error("研究任务失败");
      }
    }
    if (!completed) {
      // 超时未完成视为失败，确保研究链路问题能被发现
      throw new Error("研究任务在 60 秒内未完成");
    }

    console.log("[通过] 所有工具测试完成");
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
    await delay(500);
  }
}

void main();
