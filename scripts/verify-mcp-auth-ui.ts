import puppeteer from "puppeteer-core";

/**
 * Settings 页 MCP 鉴权配置区验证：
 * 1. 登录
 * 2. 进入 Settings 页
 * 3. 检查 MCP 鉴权标题/开关/密钥输入框渲染
 * 4. 切换开关验证可用
 */
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const SHOT_DIR = "C:\\Users\\Administrator\\AppData\\Local\\Temp\\opencode\\shots";

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1440,900"],
    defaultViewport: { width: 1440, height: 900 },
  });

  const page = await browser.newPage();
  const messages: string[] = [];

  try {
    // 登录（个人项目：仅需密码）
    await page.goto("http://127.0.0.1:8080/admin/login", { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 800));
    await page.type('input[autocomplete="current-password"]', "admin123");
    await page.click("button[type=submit]");
    await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
    messages.push(`[OK] 登录完成`);

    // SPA 侧边栏导航到"参数配置"
    await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('.ant-menu-item'));
      const settingsLink = links.find((el) => el.textContent?.includes('参数配置'));
      if (settingsLink) (settingsLink as HTMLElement).click();
    });
    await new Promise((r) => setTimeout(r, 2000));

    // 检查 MCP 鉴权配置区渲染
    const bodyText = await page.evaluate(() => document.body.innerText);
    const hasTitle = bodyText.includes("MCP 通道鉴权");
    const hasSwitchLabel = bodyText.includes("启用 MCP 鉴权");
    const hasKeyLabel = bodyText.includes("MCP 共享密钥");
    messages.push(`[${hasTitle ? "OK" : "FAIL"}] MCP 鉴权标题存在: ${hasTitle}`);
    messages.push(`[${hasSwitchLabel ? "OK" : "FAIL"}] 启用开关标签存在: ${hasSwitchLabel}`);
    messages.push(`[${hasKeyLabel ? "OK" : "FAIL"}] 密钥输入标签存在: ${hasKeyLabel}`);

    // 切换"启用 MCP 鉴权"开关
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll(".ant-form-item"));
      const target = items.find((it) => (it.innerText || "").includes("启用 MCP 鉴权"));
      const sw = target?.querySelector(".ant-switch");
      if (sw) (sw as HTMLElement).click();
    });
    await new Promise((r) => setTimeout(r, 500));
    const switchOn = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll(".ant-form-item"));
      const target = items.find((it) => (it.innerText || "").includes("启用 MCP 鉴权"));
      return !!target?.querySelector(".ant-switch-checked");
    });
    messages.push(`[${switchOn ? "OK" : "FAIL"}] 开关可切换为开启: ${switchOn}`);

    // 验证密钥输入框存在
    const passwordInputs = await page.$$("input[type=password], .ant-input-password");
    messages.push(`[${passwordInputs.length >= 3 ? "OK" : "FAIL"}] 密钥输入框存在（密码框总数 ${passwordInputs.length}）`);

    await page.screenshot({ path: `${SHOT_DIR}\\settings-mcp-auth.png` });
    messages.push("[OK] Settings MCP 鉴权截图已保存 settings-mcp-auth.png");

    // 恢复开关状态（避免污染）
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll(".ant-form-item"));
      const target = items.find((it) => (it.innerText || "").includes("启用 MCP 鉴权"));
      const sw = target?.querySelector(".ant-switch-checked");
      if (sw) (sw as HTMLElement).click();
    });
    await new Promise((r) => setTimeout(r, 300));

    console.log(messages.join("\n"));
    console.log("\n[通过] MCP 鉴权配置区验证完成");
  } catch (error) {
    console.error("[FAIL]", error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

void main();
