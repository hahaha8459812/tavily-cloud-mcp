/**
 * 获取 Tavily 官网 appSession Cookie（用于面板查询实时额度）。
 *
 * 用法（三步）：
 * 1. 以调试模式启动 Chrome/Edge（把下面的命令粘贴到"运行"或终端执行，port 可换）：
 *      Windows Chrome:  "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
 *      Windows Edge:    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9222
 *    （不想影响日常浏览器，可加 --user-data-dir="%TEMP%\tavily-debug" 用独立配置目录）
 * 2. 在该调试窗口里打开 https://app.tavily.com 并登录。
 * 3. 运行：npx tsx scripts/get-appsession-cookie.ts
 *    脚本会输出 appSession cookie，复制粘贴到面板「配置 Token」即可。
 *
 * 端口不是 9222 时：CDP_PORT=9223 npx tsx scripts/get-appsession-cookie.ts
 */
import { connect } from "puppeteer-core";

const CDP_PORT = Number(process.env.CDP_PORT ?? 9222);
const SITE = "https://app.tavily.com";

async function main() {
  let browser;
  try {
    browser = await connect({
      browserURL: `http://127.0.0.1:${CDP_PORT}`,
      defaultViewport: null,
    });
  } catch (error) {
    console.error(`无法连接 ${CDP_PORT} 端口。请先按上面步骤 1 以调试模式启动浏览器，再重试。`);
    console.error("详情：", error instanceof Error ? error.message : error);
    process.exit(1);
  }

  try {
    // 找到用户已打开的 app.tavily.com 页面（无需脚本自动跳转）
    const pages = await browser.pages();
    const tavilyPage = pages.find((p) => p.url().startsWith(SITE));

    if (!tavilyPage) {
      console.error(`没有找到已打开的 ${SITE} 页面。请先在调试窗口打开并登录该站点，再运行本脚本。`);
      process.exit(1);
    }

    const cookies = await tavilyPage.cookies(SITE);
    const session = cookies.find((c) => c.name === "appSession");

    if (!session) {
      console.error("未找到 appSession Cookie。请确认调试窗口里已登录 app.tavily.com。");
      process.exit(1);
    }

    console.log(session.value);
    console.log("\n把上面这串内容粘贴到面板「配置 Token」即可显示实时额度。");
  } finally {
    await browser.disconnect().catch(() => {});
  }
}

void main();
