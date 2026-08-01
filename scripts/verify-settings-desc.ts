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
    ok("search_depth 含积分说明", text.includes("basic/fast/ultra-fast 1 积分，advanced 2 积分"));
    ok("include_answer 不含积分说明", !text.includes("积分由搜索深度决定"));
    ok("chunks 标签注明搜索用 1-3", text.includes("每来源内容片段数（搜索用 1-3）"));
    // include_domains/exclude_domains 已从面板移除，改为 web_search 的 AI 参数
    ok("面板不再显示域名白名单配置", !text.includes("仅在这些域名内搜索"));
    ok("面板不再显示域名黑名单配置", !text.includes("排除这些域名"));

    // 2. 下拉选项档位描述（第 0 个 Select 是 search_depth）
    const depthOptions = await readSelectOptions(0);
    ok("search_depth 含 basic 档位", depthOptions.includes("basic — 通用结果（1 积分）"));
    ok("search_depth 含 advanced 档位", depthOptions.includes("advanced — 更彻底更详细（2 积分）"));
    ok("search_depth 含 fast 档位", depthOptions.includes("fast — 低延迟高相关（1 积分）"));
    ok("search_depth 含 ultra-fast 档位", depthOptions.includes("ultra-fast — 极致低延迟（1 积分）"));

    const answerOptions = await readSelectOptions(1);
    ok("include_answer 含快速答案档位", answerOptions.includes("快速答案（basic）"));
    ok("include_answer 含详细答案档位", answerOptions.includes("详细答案（advanced）"));

    const rawContentOptions = await readSelectOptions(2);
    ok("include_raw_content 含 markdown 推荐", rawContentOptions.includes("Markdown 格式（推荐）"));
    ok("include_raw_content 含 text 延迟提示", rawContentOptions.includes("纯文本（可能增加延迟）"));

    // extract_depth 下拉（Search 有 3 个 Select 后是 InputNumber/Input/Switch，Extract 区的 Select 需按顺序定位）
    const allSelects = await page.$$(".ant-select");
    ok(`页面 Select 组件数 >= 5`, allSelects.length >= 5);

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
