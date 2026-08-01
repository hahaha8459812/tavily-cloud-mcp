import puppeteer from "puppeteer-core";

/**
 * 验证：
 * 1. Settings 页修改密码表单渲染
 * 2. 登出会清除记住的密码
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
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
    await page.type('input[autocomplete="current-password"]', "admin123");
    await page.click("button[type=submit]");
    await new Promise((r) => setTimeout(r, 2000));

    // 进入 Settings
    await page.goto(`${BASE}/settings`, { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 2000));

    const oldPwd = await page.$('input[autocomplete="current-password"]');
    // AntD Input.Password 会生成一个隐藏的 password 输入；通过 label 精确验证
    const changeFormOk = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll("label"));
      const hasOld = labels.some((l) => l.textContent?.includes("当前密码"));
      const hasNew = labels.some((l) => l.textContent?.includes("新密码"));
      const hasConfirm = labels.some((l) => l.textContent?.includes("确认新密码"));
      return { hasOld, hasNew, hasConfirm };
    });
    const changeBtnText = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const btn = btns.find((b) => b.textContent?.includes("修改密码"));
      return btn ? btn.textContent.trim() : null;
    });
    console.log("[Settings] 当前密码输入框:", oldPwd ? "存在" : "无");
    console.log(
      "[Settings] 密码表单标签 当前密码:",
      changeFormOk.hasOld,
      "| 新密码:",
      changeFormOk.hasNew,
      "| 确认新密码:",
      changeFormOk.hasConfirm,
    );
    console.log("[Settings] 修改密码按钮:", changeBtnText);

    const groupColor = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll("div"));
      const el = els.find((e) => e.textContent === "管理控制台");
      return el ? window.getComputedStyle(el).color : null;
    });
    console.log("[审计] 管理控制台分组标题颜色:", groupColor);

    // 登出并验证记住的密码被清除
    const logout = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll(".ant-menu-item"));
      const item = items.find((i) => i.textContent?.includes("退出登录"));
      if (item) {
        (item as HTMLElement).click();
        return true;
      }
      return false;
    });
    await new Promise((r) => setTimeout(r, 1500));
    const savedPwd = await page.evaluate(() => localStorage.getItem("tavily_admin_password"));
    const finalUrl = page.url();
    console.log("[登出] 点击登出:", logout, "| 记住密码已清除:", savedPwd === null);
    console.log("[登出] 当前 URL:", finalUrl);

    const settingsOk =
      oldPwd !== null &&
      changeFormOk.hasOld &&
      changeFormOk.hasNew &&
      changeFormOk.hasConfirm &&
      changeBtnText === "修改密码";
    const logoutOk = logout && savedPwd === null && finalUrl.includes("/login");
    console.log(`[${settingsOk ? "通过" : "FAIL"}] 修改密码表单渲染`);
    console.log(`[${logoutOk ? "通过" : "FAIL"}] 登出清除记住密码`);
    if (!settingsOk || !logoutOk) {
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
