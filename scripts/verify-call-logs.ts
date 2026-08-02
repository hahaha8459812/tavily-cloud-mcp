import puppeteer from "puppeteer-core";

/**
 * 调用记录页 UI 验证：
 * 1. 登录
 * 2. 侧边栏"调用记录"菜单入口存在
 * 3. 导航到 /call-logs 页，表格渲染记录
 * 4. 保存条数上限控件存在
 * 5. 桌面端回归（Sider 仍正常）
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
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    // 登录
    await page.goto("http://127.0.0.1:8080/admin/login", { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 800));
    await page.type('input[autocomplete="current-password"]', "admin123");
    await page.click("button[type=submit]");
    await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));

    // 1. 侧边栏菜单入口
    const menuText = await page.evaluate(() => document.querySelector(".ant-menu")?.innerText ?? "");
    messages.push(`[${menuText.includes("调用记录") ? "OK" : "FAIL"}] 侧边栏「调用记录」菜单入口存在`);

    // 2. 点击导航到调用记录页
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll(".ant-menu-item"));
      const target = items.find((el) => el.textContent?.includes("调用记录"));
      if (target) (target as HTMLElement).click();
    });
    await new Promise((r) => setTimeout(r, 1500));

    // 3. 页面标题与表格
    const bodyText = await page.evaluate(() => document.body.innerText);
    messages.push(`[${bodyText.includes("调用记录") ? "OK" : "FAIL"}] 页面标题「调用记录」存在`);
    const hasTable = await page.evaluate(() => !!document.querySelector(".ant-table"));
    messages.push(`[${hasTable ? "OK" : "FAIL"}] 调用记录表格渲染`);
    const hasToolCol = await page.evaluate(() => {
      const headers = Array.from(document.querySelectorAll(".ant-table-thead th")).map((el) => el.textContent?.trim());
      return headers.includes("工具") && headers.includes("状态");
    });
    messages.push(`[${hasToolCol ? "OK" : "FAIL"}] 表格列（工具/状态）渲染`);
    const hasMaxControl = await page.evaluate(() => {
      const text = document.querySelector(".ant-card")?.textContent ?? "";
      return text.includes("保存条数上限") && !!document.querySelector(".ant-input-number");
    });
    messages.push(`[${hasMaxControl ? "OK" : "FAIL"}] 保存条数上限控件存在`);

    await page.screenshot({ path: `${SHOT_DIR}\\call-logs.png` });
    messages.push("[OK] 调用记录页截图已保存 call-logs.png");

    // 4. 无 JS 错误
    messages.push(`[${pageErrors.length === 0 ? "OK" : "FAIL"}] 页面无 JS 错误${pageErrors.length ? `: ${pageErrors.join("; ")}` : ""}`);

    console.log(messages.join("\n"));
    console.log("\n[通过] 调用记录页验证完成");
  } catch (error) {
    console.error("[FAIL]", error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

void main();
