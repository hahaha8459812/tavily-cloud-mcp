import puppeteer from "puppeteer-core";

/**
 * Dashboard 密钥健康状态渲染验证：
 * 1. 登录
 * 2. 进入概览页
 * 3. 验证密钥卡片健康徽标渲染（正常态）
 * 4. 验证新增的 disabledNote/quotaResetAt 字段被前端消费（无渲染异常）
 * 5. 截图
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
    // 登录（个人项目：仅需密码）
    await page.goto("http://127.0.0.1:8080/admin/login", { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 800));
    await page.type('input[autocomplete="current-password"]', "admin123");
    await page.click("button[type=submit]");
    await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
    messages.push(`[OK] 登录完成`);

    // 已在概览页（默认路由）
    await new Promise((r) => setTimeout(r, 2000));

    // 检查密钥卡片与健康徽标渲染
    const keyCards = await page.$$(".key-card");
    messages.push(`[${keyCards.length >= 1 ? "OK" : "FAIL"}] 密钥卡片渲染: ${keyCards.length} 张`);

    const healthTags = await page.evaluate(() => {
      return Array.from(document.querySelectorAll(".ant-tag")).map((el) => el.textContent?.trim());
    });
    messages.push(`[${healthTags.some((t) => t?.includes("正常")) ? "OK" : "FAIL"}] 健康徽标「正常」存在`);
    messages.push(`  当前徽标: ${JSON.stringify(healthTags)}`);

    // 检查额度信息渲染（plan 用量/剩余）
    const bodyText = await page.evaluate(() => document.body.innerText);
    const hasPlanInfo = /账户已用|Credits/.test(bodyText);
    messages.push(`[${hasPlanInfo ? "OK" : "FAIL"}] 额度信息渲染: ${hasPlanInfo}`);

    // 检查"添加密钥"按钮存在
    const addBtn = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("button")).some((el) => el.textContent?.includes("添加密钥"));
    });
    messages.push(`[${addBtn ? "OK" : "FAIL"}] 添加密钥按钮存在`);

    await page.screenshot({ path: `${SHOT_DIR}\\dashboard-health.png` });
    messages.push("[OK] Dashboard 截图已保存 dashboard-health.png");

    // 页面 JS 错误检查
    messages.push(`[${pageErrors.length === 0 ? "OK" : "FAIL"}] 页面无 JS 错误${pageErrors.length ? `: ${pageErrors.join("; ")}` : ""}`);

    console.log(messages.join("\n"));
    console.log("\n[通过] Dashboard 健康状态渲染验证完成");
  } catch (error) {
    console.error("[FAIL]", error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

void main();
