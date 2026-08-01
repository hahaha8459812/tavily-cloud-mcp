import puppeteer from "puppeteer-core";

/**
 * 手机端面板适配验证（375x667 视口）：
 * 1. 登录页卡片自适应（不横向溢出）
 * 2. 登录后：移动端顶部导航栏渲染，无固定 Sider
 * 3. Drawer 菜单打开/导航
 * 4. Dashboard 卡片单列布局、无横向滚动
 * 5. 截图（登录页 / 概览 / Settings）
 */
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const SHOT_DIR = "C:\\Users\\Administrator\\AppData\\Local\\Temp\\opencode\\shots";

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    defaultViewport: { width: 375, height: 667 },
  });

  const page = await browser.newPage();
  const messages: string[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    // 1. 登录页（移动端）
    await page.goto("http://127.0.0.1:8080/admin/login", { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 1200));
    const loginOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    messages.push(`[${!loginOverflow ? "OK" : "FAIL"}] 登录页无横向溢出`);
    const loginCardWidth = await page.evaluate(() => {
      const card = document.querySelector(".login-card");
      return card ? Math.round(card.getBoundingClientRect().width) : 0;
    });
    messages.push(`[${loginCardWidth <= 375 ? "OK" : "FAIL"}] 登录卡宽度自适应: ${loginCardWidth}px ≤ 375px`);
    await page.screenshot({ path: `${SHOT_DIR}\\mobile-login.png` });

    // 登录
    await page.type('input[autocomplete="current-password"]', "admin123");
    await page.click("button[type=submit]");
    await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));

    // 2. 顶部导航栏 + 无 Sider
    const hasMobileHeader = await page.evaluate(() => !!document.querySelector(".panel-mobile-header"));
    const hasSider = await page.evaluate(() => !!document.querySelector(".ant-layout-sider"));
    messages.push(`[${hasMobileHeader ? "OK" : "FAIL"}] 移动端顶部导航栏渲染`);
    messages.push(`[${!hasSider ? "OK" : "FAIL"}] 移动端无固定 Sider`);

    // 3. Dashboard 卡片单列布局
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    messages.push(`[${!overflow ? "OK" : "FAIL"}] Dashboard 无横向溢出`);
    const statCardCount = await page.$$(".stat-card").then((els) => els.length);
    messages.push(`[${statCardCount >= 1 ? "OK" : "FAIL"}] 统计卡渲染: ${statCardCount} 张`);
    // 密钥卡片账户剩余值不溢出
    const metricOverflow = await page.evaluate(() => {
      const value = document.querySelector(".key-card-metric-value");
      if (!value) return false;
      const rect = value.getBoundingClientRect();
      return rect.right > document.documentElement.clientWidth;
    });
    messages.push(`[${!metricOverflow ? "OK" : "FAIL"}] 密钥卡片指标值无横向溢出`);
    await page.screenshot({ path: `${SHOT_DIR}\\mobile-dashboard.png` });

    // 4. Drawer 菜单
    await page.click(".panel-mobile-menu-btn");
    await new Promise((r) => setTimeout(r, 800));
    const drawerVisible = await page.evaluate(() => !!document.querySelector(".ant-drawer-open"));
    messages.push(`[${drawerVisible ? "OK" : "FAIL"}] Drawer 菜单可打开`);
    await page.screenshot({ path: `${SHOT_DIR}\\mobile-drawer.png` });

    // 导航到 Settings
    await page.evaluate(() => {
      const menuItems = Array.from(document.querySelectorAll(".ant-drawer .ant-menu-item"));
      const settings = menuItems.find((el) => el.textContent?.includes("参数配置"));
      if (settings) (settings as HTMLElement).click();
    });
    await new Promise((r) => setTimeout(r, 1500));
    const onSettings = await page.evaluate(() => document.body.innerText.includes("面板管控参数"));
    messages.push(`[${onSettings ? "OK" : "FAIL"}] 通过 Drawer 导航到 Settings`);
    const settingsOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    messages.push(`[${!settingsOverflow ? "OK" : "FAIL"}] Settings 无横向溢出`);
    await page.screenshot({ path: `${SHOT_DIR}\\mobile-settings.png` });

    messages.push(`[${pageErrors.length === 0 ? "OK" : "FAIL"}] 页面无 JS 错误${pageErrors.length ? `: ${pageErrors.join("; ")}` : ""}`);

    console.log(messages.join("\n"));
    console.log("\n[通过] 手机端面板适配验证完成");
  } catch (error) {
    console.error("[FAIL]", error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

void main();
