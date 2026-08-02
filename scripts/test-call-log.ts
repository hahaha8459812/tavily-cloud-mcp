import { CallLog } from "../src/callLog.js";

/**
 * CallLog 内存调用记录缓冲的纯逻辑测试：
 * 1. 基本写入与读取（新→旧）
 * 2. 环形缓冲裁剪（超过上限丢弃最旧）
 * 3. 上限设置（合法/非法/立即裁剪）
 */
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`断言失败：${message}`);
  }
}

function makeEntry(overrides: Partial<Parameters<CallLog["add"]>[0]> = {}) {
  return {
    tool: "web_search",
    keyMasked: "tvly-dev****DnKd",
    costMs: 100,
    credits: 1,
    success: true,
    error: null,
    ...overrides,
  };
}

function main(): void {
  console.log("[测试 1] 基本写入与读取（新→旧）...");
  const log = new CallLog();
  log.add(makeEntry({ tool: "web_search" }));
  log.add(makeEntry({ tool: "web_extract", credits: 2 }));
  log.add(makeEntry({ tool: "web_crawl", success: false, error: "HTTP 429" }));
  const recent = log.getRecent();
  assert(recent.length === 3, "应写入 3 条");
  assert(recent[0]!.tool === "web_crawl", "最新的应排最前");
  assert(recent[2]!.tool === "web_search", "最旧的应排最后");
  assert(recent[0]!.success === false && recent[0]!.error === "HTTP 429", "失败记录应保留错误信息");
  assert(recent[1]!.credits === 2, "credits 应透出");
  assert(log.size === 3, "size 应为 3");
  // id 自增、at 为时间戳
  assert(recent[0]!.id === 3, "id 应自增到 3");
  assert(typeof recent[0]!.at === "number" && recent[0]!.at > 0, "at 应为时间戳");
  console.log("[OK] 基本写入读取通过");

  console.log("[测试 2] 环形缓冲裁剪（超过上限丢弃最旧）...");
  const capped = new CallLog();
  // 默认上限 200，写入 205 条
  for (let i = 0; i < 205; i++) {
    capped.add(makeEntry({ tool: `tool_${i}` }));
  }
  assert(capped.size === 200, "超过上限后 size 应保持 200");
  const cappedRecent = capped.getRecent();
  assert(cappedRecent[0]!.tool === "tool_204", "最新记录应保留");
  assert(cappedRecent[199]!.tool === "tool_5", "最旧应丢弃 tool_0..4，保留 tool_5");
  console.log("[OK] 环形缓冲裁剪通过");

  console.log("[测试 3] 上限设置（合法/非法/立即裁剪）...");
  const configurable = new CallLog();
  for (let i = 0; i < 50; i++) {
    configurable.add(makeEntry());
  }
  assert(configurable.getMaxEntries() === 200, "默认上限应为 200");
  // 合法设置
  assert(configurable.setMaxEntries(10) === true, "合法值 10 应成功");
  assert(configurable.getMaxEntries() === 10, "上限应更新为 10");
  assert(configurable.size === 10, "设置后应立即裁剪到 10");
  // 非法值
  assert(configurable.setMaxEntries(5) === false, "小于 10 应拒绝");
  assert(configurable.setMaxEntries(1001) === false, "大于 1000 应拒绝");
  assert(configurable.setMaxEntries(12.5) === false, "非整数应拒绝");
  assert(configurable.setMaxEntries(200) === true, "恢复 200 应成功");
  console.log("[OK] 上限设置通过");

  console.log("[通过] CallLog 内存缓冲测试全部通过");
}

main();
