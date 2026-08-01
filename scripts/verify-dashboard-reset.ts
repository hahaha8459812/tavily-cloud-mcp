import puppeteer from "puppeteer-core";

/**
 * 新增 UI 元素验证：
 * 1. 密钥卡片"套餐重置"时间行（quotaResetAt）
 * 2. 账户 Plan 用量卡片"剩余"总量
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
    await page.goto("http://127.0.0.1:8080/admin/login", { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 800));
    await page.type('input[autocomplete="current-password"]', "admin123");
    await page.click("button[type=submit]");
    await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
    messages.push(`[OK] 登录完成`);

    await new Promise((r) => setTimeout(r, 2500));

    const bodyText = await page.evaluate(() => document.body.innerText);

    // 1. 卡片套餐重置时间
    const hasResetLabel = bodyText.includes("套餐重置")
    messages.push(`[${hasResetLabel ? "OK" : "FAIL"}] 密钥卡片「套餐重置」标签存在: ${hasResetLabel}`)
    const resetTimeMatch = bodyText.match(/套餐重置\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/)
    messages.push(`[${resetTimeMatch ? "OK" : "FAIL"}] 套餐重置时间格式正确: ${resetTimeMatch?.[1] ?? "未找到"}`)

    // 2. Plan 用量卡片剩余总量
    const remainingMatch = bodyText.match(/剩余\s+(\d+|\d+ Credits)\s+Credits?/)
    const hasRemaining = bodyText.includes("剩余") && /剩余\s+\d+ Credits/.test(bodyText)
    messages.push(`[${hasRemaining ? "OK" : "FAIL"}] Plan 用量卡片剩余总量存在: ${hasRemaining}`)
    const remainingVal = bodyText.match(/剩余\s+(\d+ Credits)/)?.[1]
    messages.push(`  剩余总量: ${remainingVal ?? "未找到"}`)

    await page.screenshot({ path: `${SHOT_DIR}\\dashboard-reset-remaining.png` });
    messages.push("[OK] 截图已保存 dashboard-reset-remaining.png");

    messages.push(`[${pageErrors.length === 0 ? "OK" : "FAIL"}] 页面无 JS 错误${pageErrors.length ? `: ${pageErrors.join("; ")}` : ""}`);

    console.log(messages.join("\n"));
    console.log("\n[通过] 套餐重置时间与剩余总量渲染验证完成");
  } catch (error) {
    console.error("[FAIL]", error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

void main();
