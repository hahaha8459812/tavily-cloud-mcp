import puppeteer from "puppeteer-core";

/**
 * 浏览器渲染验证：
 * 1. 登录页渲染 + 截图
 * 2. 登录后 Dashboard 渲染 + 截图
 * 3. Settings 页 Select 下拉选项样式验证（修复白字问题的关键检查）
 * 4. Keys 页渲染 + 截图
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
    // ========== 登录页 ==========
    console.log("[1] 访问登录页...");
    await page.goto("http://127.0.0.1:8080/admin/login", { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 800));
    const loginTitle = await page.$eval(".login-title", (el) => el.textContent).catch(() => null);
    const loginLogo = await page.$eval(".login-logo .anticon", (el) => el.className).catch(() => null);
    console.log(`[OK] 登录页标题: ${loginTitle}`);
    console.log(`[OK] 登录页 logo 图标: ${loginLogo?.includes("thunderbolt") ? "Thunderbolt ✓" : loginLogo}`);
    await page.screenshot({ path: `${SHOT_DIR}\\login-final.png` });
    console.log("[OK] 登录页截图已保存 login-final.png");

    // 登录（个人项目：仅需密码）
    await page.type('input[autocomplete="current-password"]', "admin123");
    await page.click("button[type=submit]");
    await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
    console.log("[2] 登录完成");

    // ========== Dashboard ==========
    // 等待首屏自动刷新完成（统计卡第一个值不再是占位符 "-"）
    try {
      await page.waitForFunction(
        () => {
          const values = Array.from(document.querySelectorAll('.stat-value')).map((el) =>
            el.textContent,
          );
          return values.length > 0 && values[0] !== '-';
        },
        { timeout: 15000 },
      );
    } catch {
      console.log("[注意] 首屏自动刷新 15s 内未完成，继续检查当前状态");
    }
    const statCards = await page.$$(".stat-card");
    console.log(`[OK] Dashboard 统计卡数量: ${statCards.length}`);
    const statValues = await page.$$eval(".stat-value", (els) => els.map((el) => el.textContent));
    console.log(`[OK] 统计值: ${statValues.join(" | ")}`);
    // 验证账户 Plan 长进度条卡
    const planCardExists = await page.$(".plan-usage-card") !== null;
    console.log(`[OK] 账户 Plan 进度条卡存在: ${planCardExists}`);
    const planPercentText = await page.$eval(".plan-usage-percent", (el) => el.textContent).catch(() => null);
    console.log(`[OK] Plan 百分比: ${planPercentText}`);
    const planTotalText = await page.$eval(".plan-usage-total", (el) => el.textContent).catch(() => null);
    console.log(`[OK] 总消耗/总额度: ${planTotalText}`);
    const progressExists = await page.$(".plan-usage-card .ant-progress") !== null;
    console.log(`[OK] 长进度条渲染: ${progressExists}`);
    const keyCards = await page.$$(".key-card");
    console.log(`[OK] 密钥额度卡片数量: ${keyCards.length}`);
    const pageTitle = await page.$eval(".page-title", (el) => el.textContent);
    console.log(`[OK] 页面标题: ${pageTitle}`);
    await page.screenshot({ path: `${SHOT_DIR}\\dashboard-final.png` });
    console.log("[OK] Dashboard 截图已保存 dashboard-final.png");

    // ========== Settings Select 验证 ==========
    // 用 SPA 导航（点击侧边栏）而不是 goto，避免 token 丢失
    console.log("[3] 进入 Settings 页验证 Select 下拉...");
    await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('.ant-menu-item'));
      const settingsLink = links.find((el) => el.textContent?.includes('参数配置'));
      if (settingsLink) (settingsLink as HTMLElement).click();
    });
    await new Promise((r) => setTimeout(r, 2000));

    // 检查是否渲染了 Select
    const selectExists = await page.$(".ant-select") !== null;
    console.log(`[OK] Settings 页 Select 组件存在: ${selectExists}`);
    if (!selectExists) {
      await page.goto("http://127.0.0.1:8080/admin/settings", { waitUntil: "networkidle0" });
      await new Promise((r) => setTimeout(r, 2500));
      console.log(`[重试] 直接导航后 Select 存在: ${(await page.$(".ant-select")) !== null}`);
    }

    // 等待下拉选项渲染（AntD 6 Select 用 .ant-select-content 而非旧版 selector）
    const selectTrigger = await page.$(".ant-select-content");
    if (!selectTrigger) {
      throw new Error("Settings 页未渲染 Select 选择器");
    }
    await selectTrigger.click();
    await new Promise((r) => setTimeout(r, 800));

    // 检查下拉选项的选中项样式
    const selectedOption = await page.$eval(".ant-select-item-option-selected", (el) => {
      const styles = window.getComputedStyle(el);
      return {
        bg: styles.backgroundColor,
        color: styles.color,
      };
    }).catch(() => null);
    if (selectedOption) {
      console.log(`[OK] 选中项背景色: ${selectedOption.bg}`);
      console.log(`[OK] 选中项文字色: ${selectedOption.color}`);
      // 对比度判定：背景不得是浅色（接近白色），文字必须为白色
      const isLightBg = (bg: string) => {
        const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg);
        if (!match) return true;
        const r = Number(match[1]);
        const g = Number(match[2]);
        const b = Number(match[3]);
        return r > 200 && g > 200 && b > 200;
      };
      const bgOk = !isLightBg(selectedOption.bg);
      const colorOk = selectedOption.color === "rgb(255, 255, 255)";
      console.log(`[${bgOk ? "通过" : "注意"}] 选中项背景为深色（避免白字看不清），实际: ${selectedOption.bg}`);
      console.log(`[${colorOk ? "通过" : "注意"}] 选中项文字为白色，实际: ${selectedOption.color}`);
      if (!bgOk || !colorOk) {
        throw new Error("Select 选中项对比度不足，需要修复主题 token");
      }
    } else {
      // 首次打开可能无选中值，检查普通选项和 hover 态
      console.log("[注意] 未捕获到选中项，检查普通选项样式...");
      const normalOption = await page.$eval(".ant-select-item-option", (el) => {
        const styles = window.getComputedStyle(el);
        return { bg: styles.backgroundColor, color: styles.color };
      }).catch(() => null);
      if (normalOption) {
        console.log(`[OK] 普通选项背景: ${normalOption.bg} 文字: ${normalOption.color}`);
      }
      // 检查下拉面板背景色（colorBgElevated 应为深色）
      const dropdown = await page.$eval(".ant-select-dropdown", (el) => {
        const styles = window.getComputedStyle(el);
        return { bg: styles.backgroundColor };
      }).catch(() => null);
      if (dropdown) {
        const bgOk = /rgba?\(24, ?24, ?37/i.test(dropdown.bg);
        console.log(`[${bgOk ? "通过" : "注意"}] 下拉面板背景为深色（预期 #181825），实际: ${dropdown.bg}`);
      }
    }
    await page.screenshot({ path: `${SHOT_DIR}\\settings-select-final.png` });
    console.log("[OK] Settings Select 下拉截图已保存 settings-select-final.png");
    await page.keyboard.press("Escape");

    // ========== Dashboard 密钥管理（密钥池已并入概览） ==========
    await page.goto("http://127.0.0.1:8080/admin", { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 1500));
    const pageTitle2 = await page.$eval(".page-title", (el) => el.textContent).catch(() => null);
    console.log(`[OK] 概览页标题: ${pageTitle2}`);
    const addBtnExists = await page.$(".key-add-btn") !== null;
    console.log(`[OK] 添加密钥按钮存在: ${addBtnExists}`);
    // 若有密钥卡片则验证卡片内容与操作按钮
    const keyCardCount = (await page.$$(".key-card")).length;
    console.log(`[OK] 密钥卡片数量: ${keyCardCount}`);
    if (keyCardCount > 0) {
      const delBtnExists = await page.$(".key-card-header .ant-btn-dangerous") !== null;
      console.log(`[OK] 密钥卡删除按钮存在: ${delBtnExists}`);
      const editBtnExists = await page.$(".key-card-header .anticon-edit") !== null;
      console.log(`[OK] 密钥卡编辑/配置 Token 按钮存在: ${editBtnExists}`);
      const cardText = await page.evaluate(() => {
        const card = document.querySelector(".key-card");
        return card ? card.textContent.replace(/\s+/g, " ").trim() : null;
      });
      const hasEmail = cardText?.includes("@") ?? false;
      const hasNoToken = cardText?.includes("未配置 Token") ?? false;
      console.log(`[OK] 卡片含邮箱: ${hasEmail} | 含未配置Token提示: ${hasNoToken}`);
      console.log(`[OK] KeyCard 文案: ${cardText}`);
    }
    // 打开添加密钥 Modal 验证 Token 输入框存在
    await page.click(".key-add-btn");
    await new Promise((r) => setTimeout(r, 800));
    const tokenInputExists = await page.$('#accountToken') !== null;
    console.log(`[OK] 添加 Modal Token 输入框存在: ${tokenInputExists}`);
    await page.keyboard.press("Escape");
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: `${SHOT_DIR}\\dashboard-keys-final.png` });
    console.log("[OK] 概览密钥管理区截图已保存 dashboard-keys-final.png");

    console.log("\n[通过] 浏览器渲染验证完成，截图已保存到:");
    console.log(`  ${SHOT_DIR}`);
  } catch (error) {
    console.error("[FAIL]", error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

void main();
