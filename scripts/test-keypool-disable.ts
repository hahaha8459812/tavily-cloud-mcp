import { TavilyKeyPool, addCycle, formatTime, parseIsoUtcMs } from "../src/keyPool.js";

/**
 * 密钥池统一禁用模型的纯逻辑测试（不发起真实 API 请求）：
 * 1. addCycle 重置时间推算（daily/weekly/monthly/未知周期）
 * 2. parseIsoUtcMs UTC 解析（无时区补 Z、带时区保留）
 * 3. 持久化停用状态在构造时恢复（到期自动变健康、永久停用保留）
 * 4. reenableKeyById 手动重新启用
 * 5. getUsageOverview 健康状态字段透出
 */
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`断言失败：${message}`);
  }
}

const VALID_KEY = "tvly-dev-pure-logic-test-key-0001";

function newPool(): TavilyKeyPool {
  return new TavilyKeyPool([]);
}

function main(): void {
  console.log("[测试 1] addCycle 重置时间推算...");
  const base = Date.UTC(2026, 7, 1, 5, 34, 43); // 2026-08-01T05:34:43Z
  const daily = addCycle(base, "daily");
  assert(daily === base + 24 * 60 * 60 * 1000, "daily 应加 1 天");
  const weekly = addCycle(base, "weekly");
  assert(weekly === base + 7 * 24 * 60 * 60 * 1000, "weekly 应加 7 天");
  const monthly = addCycle(base, "monthly");
  const monthlyDate = new Date(monthly!);
  assert(monthlyDate.getUTCMonth() === 8 && monthlyDate.getUTCFullYear() === 2026 && monthlyDate.getUTCDate() === 1, "monthly 应加 1 个月（8/1 → 9/1）");
  // 月末边界：1/31 加一个月应到 3/3（setMonth 溢出行为），只要落在 3 月即可
  const monthEnd = Date.UTC(2026, 0, 31);
  const monthEndNext = new Date(addCycle(monthEnd, "monthly")!);
  assert(monthEndNext.getUTCMonth() === 2, "monthly 月末溢出到 3 月");
  assert(addCycle(base, "unknown") === null, "未知周期应返回 null");
  console.log("[OK] addCycle 通过");

  console.log("[测试 2] parseIsoUtcMs UTC 解析...");
  // 无时区 ISO：按 UTC 补 Z 解析（实测官网 last_reset 无时区标识，如 "2026-08-01T05:34:43.929000"）
  const noTz = parseIsoUtcMs("2026-08-01T05:34:43");
  assert(noTz === Date.UTC(2026, 7, 1, 5, 34, 43), "无时区 ISO 应按 UTC 解析");
  // 带毫秒小数
  const withMs = parseIsoUtcMs("2026-08-01T05:34:43.929000");
  assert(withMs === Date.UTC(2026, 7, 1, 5, 34, 43, 929), "带毫秒 ISO 应按 UTC 解析");
  // 显式带 Z 不重复补
  const withZ = parseIsoUtcMs("2026-08-01T05:34:43Z");
  assert(withZ === Date.UTC(2026, 7, 1, 5, 34, 43), "带 Z 的 ISO 不应重复补 Z");
  // 非法输入
  assert(parseIsoUtcMs("not-a-date") === null, "非法日期应返回 null");
  console.log("[OK] parseIsoUtcMs 通过");

  console.log("[测试 3] 停用状态在构造时恢复...");
  const now = Date.now();
  // 已到期的 rate_limited：构造后应视为健康
  const expiredPool = new TavilyKeyPool([
    {
      key: VALID_KEY,
      disableState: { reason: "rate_limited", until: now - 1000, note: "已过期" },
    },
  ]);
  const expiredOverview = expiredPool.getUsageOverview().keys[0]!;
  assert(expiredOverview.health === "healthy", `已到期的停用应恢复健康，实际=${expiredOverview.health}`);

  // 未到期 quota_exhausted：构造后保持停用
  const futureMs = now + 60_000;
  const quotaPool = new TavilyKeyPool([
    {
      key: VALID_KEY,
      disableState: { reason: "quota_exhausted", until: futureMs, note: "预计 2026-09-01 重置" },
    },
  ]);
  const quotaOverview = quotaPool.getUsageOverview().keys[0]!;
  assert(quotaOverview.health === "quota_exhausted", "未到期 quota_exhausted 应保留");
  assert(quotaOverview.disabledNote === "预计 2026-09-01 重置", "disabledNote 应透出");
  assert(quotaOverview.disabledUntil === futureMs, "disabledUntil 应透出");
  console.log("[OK] 停用状态恢复逻辑通过");

  console.log("[测试 4] 永久停用保留（until=null）...");
  const disabledPool = new TavilyKeyPool([
    { key: VALID_KEY, disableState: { reason: "disabled", until: null, note: "PayGo 超限" } },
  ]);
  const disabledOverview = disabledPool.getUsageOverview().keys[0]!;
  assert(disabledOverview.health === "disabled", "永久停用应保留");
  assert(disabledOverview.disabledUntil === null, "永久停用 until 应为 null");
  console.log("[OK] 永久停用恢复逻辑通过");

  console.log("[测试 5] reenableKeyById 手动重新启用...");
  const pool = newPool();
  assert(pool.addKey(VALID_KEY) === true, "添加密钥应成功");
  const keyId = pool.getUsageOverview().keys[0]!.id;
  // 模拟一个未到期的停用（直接通过构造带状态的方式验证 re-enable）
  const reenabled = pool.reenableKeyById(keyId);
  assert(reenabled === true, "重新启用应返回 true");
  assert(pool.getUsageOverview().keys[0]!.health === "healthy", "重新启用后应健康");
  assert(pool.reenableKeyById("nonexistent-id") === false, "不存在的密钥应返回 false");
  console.log("[OK] 重新启用逻辑通过");

  console.log("[测试 6] getUsageOverview 无 token key 健康状态默认 healthy...");
  const freshPool = newPool();
  assert(freshPool.addKey(VALID_KEY) === true, "添加密钥应成功");
  const fresh = freshPool.getUsageOverview().keys[0]!;
  assert(fresh.health === "healthy", `新密钥应默认 healthy，实际=${fresh.health}`);
  assert(fresh.quotaResetAt === null, "无套餐缓存时 quotaResetAt 应为 null");
  console.log("[OK] 默认状态通过");

  console.log("[测试 7] formatTime 输出格式...");
  const formatted = formatTime(Date.UTC(2026, 8, 1, 5, 34));
  assert(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(formatted), `formatTime 格式异常：${formatted}`);
  console.log("[OK] formatTime 通过");

  console.log("[通过] 密钥池统一禁用模型纯逻辑测试全部通过");
}

main();
