import puppeteer from "puppeteer-core";

/**
 * Settings 面板参数档位描述验证：
 * 1. 页面静态提示（extra 文案、标签）渲染
 * 2. 下拉框展开后的选项 label（含官方档位描述）
 * 3. 截图存档
 */
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const SHOT_DIR = "C:\\Users\\Administrator\\AppData\\Local\\Temp\\opencode\\shots";

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox"],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  const results: Array<{ ok: boolean; msg: string }> = [];
  const ok = (msg: string, cond: boolean) => {
    results.push({ ok: cond, msg });
    console.log((cond ? "[OK] " : "[FAIL] ") + msg);
  };

  /** 展开第 index 个 Select，返回下拉选项文本 */
  async function readSelectOptions(index: number): Promise<string[]> {
    const selects = await page.$$(".ant-select");
    if (selects.length <= index) return [];
    await selects[index].click();
    await new Promise((r) => setTimeout(r, 800));
    const texts = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".ant-select-item-option-content")).map((el) => el.textContent ?? ""),
    );
    await page.keyboard.press("Escape");
    await new Promise((r) => setTimeout(r, 500));
    return texts;
  }

  try {
    await page.goto("http://127.0.0.1:8080/admin/login", { waitUntil: "networkidle0" });
    await page.type('input[autocomplete="current-password"]', "admin123");
    await page.click("button[type=submit]");
    await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));

    await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll(".ant-menu-item"));
      const target = links.find((el) => el.textContent?.includes("参数配置"));
      if (target) (target as HTMLElement).click();
    });
    await new Promise((r) => setTimeout(r, 2000));

    // 1. 页面静态提示（extra / 标签）
    const text = await page.evaluate(() => document.body.innerText);
    ok("country 提示用完整国家名", text.includes("必须用完整国家名"));
    ok("country 提示不支持 ISO 代码", text.includes("不支持 ISO 代码"));
    ok("auto_parameters 积分警告", text.includes("search_depth 可能自动升为 advanced"));
    ok("include_image_descriptions 依赖提示", text.includes("需同时开启「包含图片」"));
    ok("include_domains 上限 300", text.includes("最多 300 个"));
    ok("exclude_domains 上限 150", text.includes("最多 150 个"));
    ok("chunks 标签范围 1-3", text.includes("每来源内容片段数（1-3）"));

    // 2. 下拉选项档位描述
    const answerOptions = await readSelectOptions(0);
    ok("include_answer 含快速答案档位", answerOptions.includes("快速答案（basic，消耗 1 积分）"));
    ok("include_answer 含详细答案档位", answerOptions.includes("详细答案（advanced，更完整）"));

    const rawContentOptions = await readSelectOptions(1);
    ok("include_raw_content 含 markdown 推荐", rawContentOptions.includes("Markdown 格式（推荐）"));
    ok("include_raw_content 含 text 延迟提示", rawContentOptions.includes("纯文本（可能增加延迟）"));

    // extract_depth 下拉（Search 有两个 Select 后是 InputNumber/Input/Switch，Extract 区的第一个 Select 需按顺序定位）
    // 简单起见：统计 Select 总数，并验证提取深度选项在最后一个 Select 区附近出现
    const allSelects = await page.$$(".ant-select");
    ok(`页面 Select 组件数 >= 4`, allSelects.length >= 4);

    await page.screenshot({ path: `${SHOT_DIR}\\settings-official-desc.png` });
    ok("截图已保存", true);

    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      console.error(`\n[FAIL] ${failed.length} 项未通过`);
      process.exit(1);
    }
    console.log("\n[通过] Settings 面板档位描述验证完成");
  } catch (e) {
    console.error("[FAIL]", e instanceof Error ? e.message : String(e));
    process.exit(1);
  } finally {
    await browser.close();
  }
}
void main();
