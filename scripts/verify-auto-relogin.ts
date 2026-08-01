import puppeteer from "puppeteer-core";

/**
 * 验证前端 401 自动续登：
 * 1. 登录进入面板
 * 2. 手动把 localStorage 的 token 改成伪造无效 token
 * 3. 触发一次刷新请求（重新加载页面走 RequireAuth 或调用 API）
 * 4. 验证：自动用记住的密码重登，页面不跳登录页，数据正常
 */
async function main() {
  const browser = await puppeteer.launch({ executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true, args: ["--no-sandbox"], defaultViewport: { width: 1440, height: 900 } });
  const page = await browser.newPage();
  const ok = (m: string, c: boolean) => console.log((c ? "[OK] " : "[FAIL] ") + m);
  try {
    await page.goto("http://127.0.0.1:8080/admin/login", { waitUntil: "networkidle0" });
    await page.type('input[autocomplete="current-password"]', "admin123");
    await page.click("button[type=submit]");
    await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1800));
    ok("已进入面板", await page.evaluate(() => document.body.innerText.includes("概览")));

    // 伪造无效 token（错误签名）
    await page.evaluate(() => {
      localStorage.setItem("tavily_admin_token", "forged.invalid.token");
    });
    console.log("[info] 已伪造无效 token");

    // 重新加载页面：RequireAuth 应检测到 token（伪造的其实非空，会被当有效直接进入，
    // 但后续 API 调用会 401 → 自动重登）
    await page.goto("http://127.0.0.1:8080/admin", { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 3000));

    // 页面发起的 /api/status 会 401 → 前端自动重登 → 恢复
    const pageText = await page.evaluate(() => document.body.innerText);
    const currentUrl = page.url();
    ok("自动重登后仍停留在面板", pageText.includes("概览") && !currentUrl.includes("/login"));
    ok("数据已恢复（统计卡非空）", pageText.includes("密钥总数"));
    const hasLoginError = pageText.includes("未登录或登录已过期");
    ok("未出现未登录报错", !hasLoginError);

    // 检查 token 是否已被重登更新（不再是伪造值）
    const newToken = await page.evaluate(() => localStorage.getItem("tavily_admin_token"));
    ok("token 已被重登更新", newToken !== "forged.invalid.token" && newToken?.includes("."));
  } catch (e) {
    console.error("[FAIL]", e instanceof Error ? e.message : String(e));
    process.exit(1);
  } finally {
    await browser.close();
  }
}
void main();