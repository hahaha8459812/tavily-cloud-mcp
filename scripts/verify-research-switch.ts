import puppeteer from "puppeteer-core";

async function main() {
  const browser = await puppeteer.launch({ executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true, args: ["--no-sandbox"], defaultViewport: { width: 1440, height: 900 } });
  const page = await browser.newPage();
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
    const text = await page.evaluate(() => document.body.innerText);
    const ok = (m: string, c: boolean) => console.log((c ? "[OK] " : "[FAIL] ") + m);
    ok("含研究工具开关标题", text.includes("启用深度研究工具"));
    ok("含开销说明", text.includes("单次消耗几十到上百积分"));
    ok("含关闭说明", text.includes("不再出现这两个工具"));
    await page.screenshot({ path: "C:/Users/Administrator/AppData/Local/Temp/opencode/shots/settings-research-switch.png" });
    ok("截图已保存", true);
  } catch (e) { console.error("[FAIL]", e instanceof Error ? e.message : String(e)); process.exit(1); }
  finally { await browser.close(); }
}
void main();