import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 等待 HTTP 服务就绪 */
export async function waitForServer(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
      return true;
    } catch {
      await delay(500);
    }
  }
  return false;
}

/** 启动 MCP 服务器子进程，注册 error 监听并在退出时可靠清理 */
export function startServerProcess(): ChildProcess {
  const serverProcess = spawn(
    process.execPath,
    [path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs"), "src/index.ts"],
    { cwd: projectRoot, env: process.env, stdio: ["ignore", "inherit", "inherit"] },
  );

  serverProcess.on("error", (error) => {
    console.error("[FAIL] 服务器子进程启动失败：", error);
  });

  return serverProcess;
}

/** 可靠终止子进程：即使 client.close() 抛错也保证 kill 执行 */
export async function stopServerProcess(serverProcess: ChildProcess): Promise<void> {
  if (serverProcess.exitCode !== null) {
    return; // 已退出
  }
  serverProcess.kill();
  // 等待进程退出，最多 3 秒
  const exitPromise = new Promise<void>((resolve) => {
    serverProcess.once("exit", () => resolve());
  });
  await Promise.race([exitPromise, delay(3000)]);
}

/** 调用 MCP 工具；isError 时抛出原始错误文本，避免 JSON.parse 掩盖真实错误 */
export async function callToolAndParse(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content
    .filter((item) => item.type === "text")
    .map((item) => (item as { text: string }).text)
    .join("\n");

  if (result.isError) {
    throw new Error(`工具 ${name} 返回错误：${text}`);
  }

  return JSON.parse(text);
}
