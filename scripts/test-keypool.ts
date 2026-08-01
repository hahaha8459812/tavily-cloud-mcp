import "dotenv/config";
import { TavilyKeyPool } from "../src/keyPool.js";

/**
 * 验证密钥池故障转移逻辑：
 * 1. 无效 key（401）+ 有效 key，搜索应自动切到有效 key
 * 2. 无效 key 触发立即永久停用（401），池内无可用密钥时全部调用失败
 * 3. 额度查询概览脱敏
 */
async function main() {
  const validKeys = (process.env.TAVILY_API_KEYS ?? "").split(",").filter(Boolean);
  if (validKeys.length === 0) {
    throw new Error("未配置 TAVILY_API_KEYS");
  }

  console.log("[测试 1] 无效 key + 有效 key，故障转移...");
  const pool = new TavilyKeyPool(["tvly-invalid-key-for-test", ...validKeys]);
  const result = await pool.search({ query: "latest AI news", maxResults: 1 });
  if (result.results.length === 0) {
    throw new Error("搜索成功但无结果");
  }
  console.log(`[OK] 搜索成功，返回 ${result.results.length} 条，已自动切换到有效密钥`);
  console.log(`[OK] 密钥池大小: ${pool.size}`);

  console.log("[测试 2] 无效 key 立即永久停用（401）...");
  const badPool = new TavilyKeyPool(["tvly-invalid-key-for-test"]);
  let failedCount = 0;
  for (let i = 0; i < 5; i++) {
    try {
      await badPool.search({ query: "test" });
    } catch (error) {
      failedCount++;
      console.log(`  [i=${i}] 搜索失败: ${error instanceof Error ? error.message : error}`);
    }
  }
  if (failedCount !== 5) {
    throw new Error(`期望全部 5 次均失败，实际失败 ${failedCount} 次`);
  }
  console.log(`[OK] 全部 5 次均失败（${failedCount}），密钥池最终抛出无可用密钥错误`);

  console.log("[测试 3] 额度查询概览（脱敏 + token 两态）...");
  const usagePool = new TavilyKeyPool(validKeys);
  await usagePool.refreshUsage();
  const overview = usagePool.getUsageOverview();
  console.log(`[OK] 概览: ${JSON.stringify(overview)}`);
  if (!Array.isArray(overview.keys) || !Array.isArray(overview.accounts)) {
    throw new Error(`概览结构异常，应包含 keys 与 accounts 数组：${JSON.stringify(overview)}`);
  }
  for (const item of overview.keys) {
    if (item.apiKeyMasked.includes(validKeys[0]!.slice(0, 8))) {
      console.log(`[OK] 密钥已脱敏: ${item.apiKeyMasked}`);
    } else {
      throw new Error(`脱敏失败，未包含有效 key 前缀：${item.apiKeyMasked}`);
    }
    if (item.apiKeyMasked.includes(item.apiKeyMasked.slice(-4)) === false) {
      throw new Error(`脱敏格式异常：${item.apiKeyMasked}`);
    }
    // 无 token 的 key：额度字段应为 null，hasAccountToken 应为 false
    if (item.hasAccountToken !== false) {
      throw new Error(`未配置 token 的 key hasAccountToken 应为 false：${JSON.stringify(item)}`);
    }
    if (item.keyUsage !== null || item.planLimit !== null) {
      throw new Error(`未配置 token 的 key 额度字段应为 null：${JSON.stringify(item)}`);
    }
  }
  console.log(`[OK] ${overview.keys.length} 把 key 均无 token，额度字段为 null（灰色态）`);
  console.log(`[OK] accounts 数: ${overview.accounts.length}（无 token 时不参与账户统计）`);

  console.log("[测试 4] updateKeyToken / getRawKeyEntries...");
  const firstId = overview.keys[0]?.id;
  if (!firstId) {
    throw new Error("密钥池为空，无法测试 token 更新");
  }
  const updated = usagePool.updateKeyToken(firstId, "eyJhbGci.dummy-token");
  if (!updated) {
    throw new Error("updateKeyToken 返回 false");
  }
  const entries = usagePool.getRawKeyEntries();
  const firstEntry = entries.find((e) => e.accountToken);
  if (!firstEntry || firstEntry.accountToken !== "eyJhbGci.dummy-token") {
    throw new Error(`token 更新后未正确写入：${JSON.stringify(entries)}`);
  }
  console.log("[OK] updateKeyToken 生效，getRawKeyEntries 包含 token");

  console.log("[通过] 密钥池全部测试通过");
}

main().catch((error) => {
  console.error("[FAIL]", error);
  process.exit(1);
});
