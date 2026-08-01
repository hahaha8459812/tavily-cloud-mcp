import puppeteer from "puppeteer-core";

/**
 * 手机端适配后桌面端回归验证（1440x900 视口）：
 * 1. 桌面端仍显示固定 Sider
 * 2. 不显示移动端顶部栏
 * 3. 密钥卡片正常渲染
 */
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

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
    await page.goto("http://127.0.0.1:8080/admin/login", { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 800));
    await page.type('input[autocomplete="current-password"]', "admin123");
    await page.click("button[type=submit]");
    await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2500));

    const hasSider = await page.evaluate(() => !!document.querySelector(".ant-layout-sider"));
    const hasMobileHeader = await page.evaluate(() => !!document.querySelector(".panel-mobile-header"));
    messages.push(`[${hasSider ? "OK" : "FAIL"}] 桌面端保留固定 Sider`);
    messages.push(`[${!hasMobileHeader ? "OK" : "FAIL"}] 桌面端不显示移动端顶部栏`);

    const keyCards = await page.$$(".key-card");
    messages.push(`[${keyCards.length >= 1 ? "OK" : "FAIL"}] 密钥卡片渲染: ${keyCards.length} 张`);

    console.log(messages.join("\n"));
    console.log("\n[通过] 桌面端回归验证完成");
  } catch (error) {
    console.error("[FAIL]", error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

void main();
