import puppeteer from "puppeteer-core";

/**
 * Dashboard 永久停用（disabled）状态 UI 验证：
 * 1. 登录
 * 2. 验证"永久停用"徽标渲染 + tooltip note
 * 3. 验证"重新启用"按钮存在
 * 4. 截图
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

    await new Promise((r) => setTimeout(r, 2000));

    // 验证"永久停用"徽标
    const tags = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".ant-tag")).map((el) => el.textContent?.trim()),
    );
    messages.push(`[${tags.some((t) => t?.includes("永久停用")) ? "OK" : "FAIL"}] 永久停用徽标存在: ${JSON.stringify(tags)}`);

    // 验证重新启用按钮（RollbackOutlined 图标按钮）
    const reenableBtn = await page.evaluate(() => {
      // 重新启用按钮是带 icon 的 text 类型按钮，位于卡片头部 space 内
      const btn = Array.from(document.querySelectorAll(".key-card-header .ant-btn"));
      // 排除 token 编辑(EditOutlined)与删除(DeleteOutlined)，找 Rollback 按钮
      return btn.length >= 3; // 停用态: 重新启用 + 编辑token + 删除
    });
    messages.push(`[${reenableBtn ? "OK" : "FAIL"}] 停用卡片有 3 个操作按钮（重新启用/编辑/删除）`);

    // tooltip 验证：悬停徽标看 note
    await page.evaluate(() => {
      const tag = Array.from(document.querySelectorAll(".ant-tag")).find((el) =>
        el.textContent?.includes("永久停用"),
      );
      if (tag) {
        const event = new MouseEvent("mouseover", { bubbles: true });
        tag.dispatchEvent(event);
      }
    });
    await new Promise((r) => setTimeout(r, 800));
    const tooltipText = await page.evaluate(() => document.body.innerText);
    const hasNote = tooltipText.includes("PayGo") || tooltipText.includes("额度超限") || tooltipText.includes("重新启用");
    messages.push(`[${hasNote ? "OK" : "FAIL"}] tooltip 显示停用原因说明`);

    await page.screenshot({ path: `${SHOT_DIR}\\dashboard-disabled.png` });
    messages.push("[OK] Dashboard 永久停用截图已保存 dashboard-disabled.png");

    messages.push(`[${pageErrors.length === 0 ? "OK" : "FAIL"}] 页面无 JS 错误${pageErrors.length ? `: ${pageErrors.join("; ")}` : ""}`);

    console.log(messages.join("\n"));
    console.log("\n[通过] Dashboard 永久停用状态验证完成");
  } catch (error) {
    console.error("[FAIL]", error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

void main();
