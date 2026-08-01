import puppeteer from "puppeteer-core";

/**
 * 验证自动登录流程：
 * 1. 打开登录页，输入密码登录（记住密码写入 localStorage）
 * 2. 手动清除 token（模拟 token 24h 过期）
 * 3. 刷新页面 → 应自动静默登录进入面板（RequireAuth 用记住的密码自动换 token）
 */
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://127.0.0.1:8080/admin";

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox"],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();

  try {
    // 1. 首次登录（此时浏览器无记住密码）
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
    await page.type('input[autocomplete="current-password"]', "admin123");
    await page.click("button[type=submit]");
    await new Promise((r) => setTimeout(r, 2500));
    const afterLoginUrl = page.url();
    console.log("[1] 首次登录后 URL:", afterLoginUrl);

    // 2. 模拟 token 过期：清除 token 但保留记住的密码
    await page.evaluate(() => {
      localStorage.removeItem("tavily_admin_token");
    });
    console.log("[2] 已清除 token（模拟过期），记住的密码保留");

    // 3. 直接访问面板根路径 → 应自动静默登录
    await page.goto(`${BASE}`, { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 3000));
    const autoUrl = page.url();
    console.log("[3] 清除 token 后访问面板 URL:", autoUrl);

    // 4. 验证已自动登录（页面有统计卡，而非停留在登录页）
    const pageTitle = await page.$eval(".page-title", (el) => el.textContent).catch(() => null);
    const statCards = await page.$$(".stat-card");
    console.log("[4] 自动登录后页面标题:", pageTitle, "| 统计卡数量:", statCards.length);

    const autoLoginOk = !autoUrl.includes("/login") && statCards.length >= 2;
    console.log(`[${autoLoginOk ? "通过" : "FAIL"}] 自动登录验证`);

    if (!autoLoginOk) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

void main().catch((error) => {
  console.error("[FAIL]", error);
  process.exit(1);
});
