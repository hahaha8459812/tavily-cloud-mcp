import puppeteer from "puppeteer-core";

/**
 * 验证 Select 选中项两种状态的对比度：
 * 1. 纯选中态（非悬停）：应使用 optionSelectedBg = rgba(99,102,241,0.35) 深色
 * 2. 选中+悬停态：应使用 controlItemBgActiveHover = rgba(129,140,248,0.35) 深色
 */
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox"],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();

  try {
    await page.goto("http://127.0.0.1:8080/admin/login", { waitUntil: "networkidle0" });
    await page.type('input[autocomplete="current-password"]', "admin123");
    await page.click("button[type=submit]");
    await new Promise((r) => setTimeout(r, 1500));

    await page.goto("http://127.0.0.1:8080/admin/settings", { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 2000));

    await page.click(".ant-select-content");
    await new Promise((r) => setTimeout(r, 800));

    // hover 到第一个非选中项，让 selected 项失去 active 态
    const firstOption = await page.$(".ant-select-item-option:not(.ant-select-item-option-selected)");
    if (firstOption) {
      await firstOption.hover();
      await new Promise((r) => setTimeout(r, 400));
    }

    // 读取纯选中态（无 active）
    const pureSelected = await page.evaluate(() => {
      const el = document.querySelector(".ant-select-item-option-selected:not(.ant-select-item-option-active)");
      if (!el) return null;
      const s = window.getComputedStyle(el);
      return { bg: s.backgroundColor, color: s.color };
    });
    console.log("[纯选中态(非悬停)]", JSON.stringify(pureSelected));

    // hover 回选中项
    const sel = await page.$(".ant-select-item-option-selected");
    if (sel) {
      await sel.hover();
      await new Promise((r) => setTimeout(r, 400));
    }

    // 读取选中+悬停态
    const activeSelected = await page.evaluate(() => {
      const el = document.querySelector(".ant-select-item-option-selected.ant-select-item-option-active");
      if (!el) return null;
      const s = window.getComputedStyle(el);
      return { bg: s.backgroundColor, color: s.color };
    });
    console.log("[选中+悬停态]", JSON.stringify(activeSelected));

    // 判定对比度：背景不得是浅色（接近白色），文字必须为白色
    const isLightBg = (bg: string | null) => {
      if (!bg) return true;
      const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg);
      if (!match) return true;
      const r = Number(match[1]);
      const g = Number(match[2]);
      const b = Number(match[3]);
      // 背景色亮度判定：r/g/b 都偏白（如 rgb(240,242,255)）视为浅色
      return r > 200 && g > 200 && b > 200;
    };
    const isWhiteText = (color: string | null) => !!color && color === "rgb(255, 255, 255)";

    const pureOk = pureSelected && !isLightBg(pureSelected.bg) && isWhiteText(pureSelected.color);
    const activeOk = activeSelected && !isLightBg(activeSelected.bg) && isWhiteText(activeSelected.color);
    console.log(`[${pureOk ? "通过" : "注意"}] 纯选中态对比度（背景 ${pureSelected?.bg} / 文字 ${pureSelected?.color}）`);
    console.log(`[${activeOk ? "通过" : "注意"}] 选中+悬停态对比度（背景 ${activeSelected?.bg} / 文字 ${activeSelected?.color}）`);

    if (!pureOk || !activeOk) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

void main();
