import {
  TavilyClient,
  TavilyClientError,
  getAccountUsageByToken,
  type TavilyAccountInfo,
  type TavilyExtractParams,
  type TavilyExtractResponse,
  type TavilyCrawlParams,
  type TavilyCrawlResponse,
  type TavilyMapParams,
  type TavilyMapResponse,
  type TavilyResearchParams,
  type TavilyResearchCreatedResponse,
  type TavilyResearchStatusResponse,
  type TavilySearchParams,
  type TavilySearchResponse,
} from "./tavily.js";
import { createHash } from "node:crypto";
import type { ApiKeyEntry } from "./configStore.js";

/** 密钥停用原因（统一禁用模型：面板据此区分展示） */
export type DisableReason = "rate_limited" | "quota_exhausted" | "disabled";

/** 密钥的停用状态；null 表示健康可用 */
export interface KeyDisableState {
  reason: DisableReason;
  /** 自动恢复时间戳（毫秒）；disabled（永久停用）为 null，仅可手动重新启用 */
  until: number | null;
  /** 面板展示说明（如"预计 2026-09-01 重置"） */
  note?: string;
}

/** 密钥健康状态（面板展示语义） */
export type KeyHealth = "healthy" | DisableReason;

/** 无 accountToken（或缓存缺失）的 key 在 432 额度耗尽时的兜底冷却：12 小时后自动试探一次 */
const QUOTA_PROBE_INTERVAL_MS = 12 * 60 * 60 * 1000;
/** 429 限流未返回 retry-after 响应头时的兜底停用时长 */
const RATE_LIMIT_FALLBACK_MS = 60_000;
/** refreshUsage 节流窗口：get_key_usage 等非强制刷新在此窗口内复用最近结果，减少官网请求 */
const USAGE_REFRESH_THROTTLE_MS = 5 * 60 * 1000;
/** 密钥指纹长度（sha256 前 N 位 hex），用于面板安全引用 */
const KEY_ID_LENGTH = 16;
/** 脱敏展示：保留前缀长度 */
const KEY_MASK_PREFIX_LENGTH = 8;
/** 脱敏展示：保留后缀长度 */
const KEY_MASK_SUFFIX_LENGTH = 4;

interface PooledKey {
  apiKey: string;
  client: TavilyClient;
  /** 停用状态；null 表示健康 */
  disableState: KeyDisableState | null;
  /** 官网 appSession token（可选），用于实时额度查询；未配置则无额度展示 */
  accountToken: string | null;
  /** 最近一次官网账户额度查询结果（可能为 null 表示未知） */
  lastAccountInfo: TavilyAccountInfo | null;
}

/** 将持久化的可选套餐缓存规范化为实时查询结构（缺失字段补默认值） */
function normalizeAccountInfo(raw: ApiKeyEntry["accountInfo"] | null): TavilyAccountInfo | null {
  if (!raw) {
    return null;
  }
  return {
    email: raw.email ?? "",
    usage: raw.usage ?? 0,
    limit: raw.limit ?? 0,
    planName: raw.planName ?? "unknown",
    lastReset: raw.lastReset ?? null,
    resetCycle: raw.resetCycle ?? null,
    paygo: raw.paygo === true,
    paygoUsage: raw.paygoUsage ?? 0,
    paygoLimit: raw.paygoLimit ?? null,
  };
}

/**
 * 多密钥轮询池。
 * - 按 round-robin 顺序选择健康密钥
 * - 错误触发停用（统一模型）：
 *   - 429 限流 → 按 retry-after 倒计时短期停用（无响应头兜底 60 秒）
 *   - 432 套餐额度耗尽 → 有套餐缓存时禁用到下次重置，否则兜底 12 小时后试探一次
 *   - 433 PayGo 超限 / 401 密钥无效 → 永久停用（仅手动重新启用）
 *   - 额度恢复（refreshUsage 探测到 usage < limit 或 paygo 恢复）自动解除停用
 * - 停用状态与套餐缓存持久化到 config.json，容器重启后恢复
 * - refreshUsage 按 accountToken 去重：同一账户多个 key 只请求官网一次
 */
export class TavilyKeyPool {
  private keys: PooledKey[];
  private nextIndex = 0;
  /** 进行中的全量额度刷新（并发调用合并为一次） */
  private refreshInFlight: Promise<void> | null = null;
  /** 最近一次成功刷新完成时间（节流用） */
  private lastRefreshAt = 0;
  /** 状态变化后的持久化回调（由 index.ts 接 line 到 persistKeys） */
  private onPersist: (() => void) | null = null;

  constructor(apiKeyEntries: Array<ApiKeyEntry | string>) {
    this.keys = [];
    for (const entry of apiKeyEntries) {
      const apiKey = typeof entry === "string" ? entry : entry.key;
      const accountToken = typeof entry === "string" ? null : (entry.accountToken ?? null);
      const disableState = typeof entry === "string" ? null : (entry.disableState ?? null);
      const accountInfo = typeof entry === "string" ? null : (entry.accountInfo ?? null);
      this.addKey(apiKey, accountToken, disableState, accountInfo);
    }
  }

  /** 池内密钥数量 */
  get size(): number {
    return this.keys.length;
  }

  /** 注册持久化回调：状态变化（停用/恢复/套餐缓存更新）时触发，用于落盘 config.json */
  setPersistCallback(callback: () => void): void {
    this.onPersist = callback;
  }

  /** 状态变更后触发持久化（异步安全：只负责通知，写入失败由调用方兜底） */
  private requestPersist(): void {
    this.onPersist?.();
  }

  /**
   * 新增一个密钥到池中。
   * 支持传入持久化的停用状态与套餐缓存（用于重启恢复）；accountToken 可选。
   * 返回是否成功（重复或格式不合法不添加）。
   */
  addKey(
    apiKey: string,
    accountToken: string | null = null,
    disableState: KeyDisableState | null = null,
    accountInfo: ApiKeyEntry["accountInfo"] | null = null,
  ): boolean {
    const trimmed = apiKey.trim();
    // Tavily API Key 以 tvly- 开头；格式校验失败时面板会收到明确错误
    if (!trimmed.startsWith("tvly-") || trimmed.length < 12) {
      return false;
    }
    if (this.keys.some((key) => key.apiKey === trimmed)) {
      return false;
    }
    // 重启恢复的停用状态若已过期则自动视为健康；until 为 null 的永久停用保留
    const restoredState = this.isStateExpired(disableState) ? null : disableState;
    this.keys.push({
      apiKey: trimmed,
      client: new TavilyClient(trimmed),
      disableState: restoredState,
      accountToken: accountToken && accountToken.trim().length > 0 ? accountToken.trim() : null,
      lastAccountInfo: normalizeAccountInfo(accountInfo),
    });
    return true;
  }

  /** 判断停用状态是否已过期（until 为 null 的永久停用永不过期） */
  private isStateExpired(state: KeyDisableState | null): boolean {
    return state !== null && state.until !== null && Date.now() >= state.until;
  }

  /** 获取全部密钥条目（含 accountToken/停用状态/套餐缓存，供持久化到 config.json，注意敏感） */
  getRawKeyEntries(): Array<{
    key: string;
    accountToken: string | null;
    disableState: KeyDisableState | null;
    accountInfo: TavilyAccountInfo | null;
  }> {
    return this.keys.map((key) => ({
      key: key.apiKey,
      accountToken: key.accountToken,
      disableState: key.disableState,
      accountInfo: key.lastAccountInfo,
    }));
  }

  /** 更新指定密钥的 accountToken（null 表示清除），返回是否成功 */
  updateKeyToken(keyId: string, accountToken: string | null): boolean {
    const key = this.keys.find((item) => this.keyId(item.apiKey) === keyId);
    if (!key) {
      return false;
    }
    key.accountToken = accountToken && accountToken.trim().length > 0 ? accountToken.trim() : null;
    key.lastAccountInfo = null; // token 变化后旧额度数据失效，待下次刷新
    return true;
  }

  /** 判断密钥是否可用：无停用状态（健康）或停用已到期 */
  private isUsable(key: PooledKey): boolean {
    return key.disableState === null || this.isStateExpired(key.disableState);
  }

  /**
   * 按 round-robin 选择下一个可用密钥。
   * 从当前游标开始扫描一轮，跳过处于禁用期的密钥。
   * 若全部不可用则返回 null。
   */
  private pickNextUsableKey(): PooledKey | null {
    const total = this.keys.length;
    for (let offset = 0; offset < total; offset++) {
      const index = (this.nextIndex + offset) % total;
      const key = this.keys[index]!;
      if (this.isUsable(key)) {
        this.nextIndex = (index + 1) % total;
        return key;
      }
    }
    return null;
  }

  /**
   * 停用密钥（唯一停用入口）。
   * reason 决定面板展示与恢复方式；until 为 null 表示永久停用仅手动恢复。
   * 状态变化后触发持久化，保证重启不丢。
   */
  private setKeyDisabled(key: PooledKey, state: KeyDisableState): void {
    key.disableState = state;
    this.requestPersist();
  }

  /** 恢复密钥为健康状态（唯一恢复入口），状态变化后触发持久化 */
  private resetKeyHealth(key: PooledKey): void {
    if (key.disableState === null) {
      return;
    }
    key.disableState = null;
    this.requestPersist();
  }

  /** 429 限流：按 retry-after 倒计时短期停用 */
  private disableForRateLimit(key: PooledKey, retryAfterMs: number | null): void {
    const durationMs = retryAfterMs ?? RATE_LIMIT_FALLBACK_MS;
    const until = Date.now() + Math.max(durationMs, 1000);
    const seconds = Math.ceil((until - Date.now()) / 1000);
    this.setKeyDisabled(key, {
      reason: "rate_limited",
      until,
      note: `限流中，约 ${seconds} 秒后恢复`,
    });
    console.warn(`密钥 ${this.maskKey(key.apiKey)} 触发限流(429)，停用 ${seconds} 秒`);
  }

  /** 432 套餐额度耗尽：有套餐缓存时精算下次重置时间，否则兜底冷却后自动试探 */
  private disableForQuotaExhausted(key: PooledKey): void {
    const resetAtMs = this.computeNextResetMs(key.lastAccountInfo);
    if (resetAtMs !== null) {
      const dateText = formatTime(resetAtMs);
      this.setKeyDisabled(key, {
        reason: "quota_exhausted",
        until: resetAtMs,
        note: `套餐额度耗尽，预计 ${dateText} 重置`,
      });
      console.warn(`密钥 ${this.maskKey(key.apiKey)} 套餐额度耗尽(432)，预计 ${dateText} 重置`);
      return;
    }
    // 无套餐缓存（未配置 token 或尚未刷新到）：冷却一个周期后自动试探一次
    const until = Date.now() + QUOTA_PROBE_INTERVAL_MS;
    this.setKeyDisabled(key, {
      reason: "quota_exhausted",
      until,
      note: "套餐额度耗尽，12 小时后自动探测恢复",
    });
    console.warn(
      `密钥 ${this.maskKey(key.apiKey)} 套餐额度耗尽(432)，无套餐缓存，12 小时后自动探测`,
    );
  }

  /** 433 PayGo 超限 / 401 密钥无效：永久停用，仅手动重新启用 */
  private disablePermanently(key: PooledKey, statusCode: number): void {
    const note = statusCode === 433 ? "PayGo 额度超限，调整上限后可手动重新启用" : "密钥无效，请更换密钥或手动重新启用";
    this.setKeyDisabled(key, {
      reason: "disabled",
      until: null,
      note,
    });
    console.warn(`密钥 ${this.maskKey(key.apiKey)} ${statusCode === 433 ? "PayGo 超限(433)" : "鉴权失败(401)"}，永久停用`);
  }

  /** 根据套餐缓存精算下次额度重置时间；缓存缺失或无法推算时返回 null */
  private computeNextResetMs(info: TavilyAccountInfo | null): number | null {
    if (!info?.lastReset || !info.resetCycle) {
      return null;
    }
    const lastResetMs = parseIsoUtcMs(info.lastReset);
    if (lastResetMs === null) {
      return null;
    }
    const nextMs = addCycle(lastResetMs, info.resetCycle);
    if (nextMs === null) {
      return null;
    }
    // 兜底：推算结果若早于当前时间（缓存过期），退回冷却试探
    return nextMs > Date.now() ? nextMs : null;
  }

  /** 判断错误是否可转移（触发停用后切换到下一个密钥） */
  private isFailoverableError(error: unknown): boolean {
    if (!(error instanceof TavilyClientError)) {
      return false;
    }
    // 401 鉴权失败、429 限流、432 密钥额度超限、433 PayGo 超限
    return (
      error.statusCode === 401 ||
      error.statusCode === 429 ||
      error.statusCode === 432 ||
      error.statusCode === 433
    );
  }

  /** 按错误状态码执行对应的停用策略，返回错误是否已作为可转移错误处理 */
  private applyDisablePolicy(key: PooledKey, error: unknown): boolean {
    if (!(error instanceof TavilyClientError)) {
      return false;
    }
    switch (error.statusCode) {
      case 429:
        this.disableForRateLimit(key, error.retryAfterMs);
        return true;
      case 432:
        this.disableForQuotaExhausted(key);
        return true;
      case 433:
      case 401:
        this.disablePermanently(key, error.statusCode);
        return true;
      default:
        return false;
    }
  }

  /**
   * 在密钥池上执行一次带故障转移的 Tavily 调用。
   * 成功/最终失败都会输出一条审计日志（时间、工具、耗时、key 指纹、消耗 credits），
   * 用于追踪额度消耗来源与各 key 使用分布。
   * @param operation 针对某个 TavilyClient 执行的实际请求
   * @returns 请求结果
   * @throws 所有密钥都不可用或全部失败时抛出最后一个错误
   */
  private async executeWithFailover<T>(
    operation: (client: TavilyClient) => Promise<T>,
    operationName: string,
  ): Promise<T> {
    const attempted = new Set<PooledKey>();
    let lastError: Error | null = null;
    let lastKey: PooledKey | null = null;
    const startedAt = Date.now();

    for (let round = 0; round < this.keys.length; round++) {
      const key = this.pickNextUsableKey();
      if (!key) {
        break;
      }
      if (attempted.has(key)) {
        continue;
      }
      attempted.add(key);
      lastKey = key;

      try {
        const result = await operation(key.client);
        this.resetKeyHealth(key);
        this.logCallAudit(operationName, key, startedAt, result, null);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (this.isFailoverableError(error)) {
          console.warn(
            `密钥 ${this.maskKey(key.apiKey)} ${operationName}返回可转移错误：${lastError.message}，切换到下一个密钥`,
          );
          this.applyDisablePolicy(key, error);
          continue;
        }
        throw error;
      }
    }

    this.logCallAudit(operationName, lastKey, startedAt, null, lastError);
    const message = lastError
      ? `所有密钥均不可用：${lastError.message}`
      : "密钥池中无可用密钥";
    throw new Error(message);
  }

  /** 输出一条 MCP 调用审计日志：时间/工具/耗时/key 指纹/消耗 credits（成功或失败） */
  private logCallAudit(
    operationName: string,
    key: PooledKey | null,
    startedAt: number,
    result: unknown,
    error: Error | null,
  ): void {
    const keyMasked = key ? this.maskKey(key.apiKey) : "无可用密钥";
    const costMs = Date.now() - startedAt;
    if (error) {
      console.error(`[审计] ${operationName} 失败 | key=${keyMasked} | 耗时=${costMs}ms | 原因=${error.message}`);
      return;
    }
    const credits = extractCreditsFromResponse(result);
    const creditsText = credits !== null ? `${credits} credits` : "credits 未知";
    console.log(`[审计] ${operationName} 成功 | key=${keyMasked} | 耗时=${costMs}ms | 消耗=${creditsText}`);
  }

  async search(params: TavilySearchParams): Promise<TavilySearchResponse> {
    return this.executeWithFailover(
      (client) => client.search(params),
      "搜索",
    );
  }

  async extract(params: TavilyExtractParams): Promise<TavilyExtractResponse> {
    return this.executeWithFailover(
      (client) => client.extract(params),
      "提取",
    );
  }

  async crawl(params: TavilyCrawlParams): Promise<TavilyCrawlResponse> {
    return this.executeWithFailover(
      (client) => client.crawl(params),
      "爬取",
    );
  }

  async map(params: TavilyMapParams): Promise<TavilyMapResponse> {
    return this.executeWithFailover(
      (client) => client.map(params),
      "站点地图",
    );
  }

  async createResearch(
    params: TavilyResearchParams,
  ): Promise<TavilyResearchCreatedResponse> {
    return this.executeWithFailover(
      (client) => client.createResearch(params),
      "创建研究任务",
    );
  }

  async getResearchStatus(requestId: string): Promise<TavilyResearchStatusResponse> {
    return this.executeWithFailover(
      (client) => client.getResearchStatus(requestId),
      "查询研究任务",
    );
  }

  /**
   * 刷新所有配置了 accountToken 的密钥额度状态（节流：force 为 false 且最近刷新过则复用结果）。
   * - 按 accountToken 去重：同一账户多个 key 只请求官网一次，结果共享
   * - 每次调用捕获 Set-Cookie 中的新 appSession 并回写内存，由调用方负责持久化
   * - 额度恢复检测：quota_exhausted/disabled 的 key 探测到 usage < limit（或 paygo 恢复）自动解除
   * - 无 token 的密钥跳过（额度数据保持未知）
   * 并发调用会合并为一次刷新，避免重复请求官网接口。
   */
  async refreshUsage(force = false): Promise<void> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }
    if (!force && this.lastRefreshAt > 0 && Date.now() - this.lastRefreshAt < USAGE_REFRESH_THROTTLE_MS) {
      return;
    }
    this.refreshInFlight = this.doRefreshUsage().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async doRefreshUsage(): Promise<void> {
    // 按 accountToken 去重：同一 token（同一账户）只请求一次官网
    const tokenToKeys = new Map<string, PooledKey[]>();
    for (const key of this.keys) {
      if (!key.accountToken) {
        continue;
      }
      const list = tokenToKeys.get(key.accountToken) ?? [];
      list.push(key);
      tokenToKeys.set(key.accountToken, list);
    }

    // 至少一次查询成功才更新节流时间：全部失败时不冻结刷新窗口，避免额度长期停留在失败前状态
    let anySucceeded = false;
    await Promise.all(
      Array.from(tokenToKeys.entries()).map(async ([token, tokenKeys]) => {
        try {
          const { account, newToken } = await getAccountUsageByToken(token);
          anySucceeded = true;
          for (const key of tokenKeys) {
            key.lastAccountInfo = account;
            // token 续期：同一账户各 key 共用一个新 token
            if (newToken && newToken !== key.accountToken) {
              key.accountToken = newToken;
            }
            // 额度恢复检测：仅套餐额度耗尽（quota_exhausted）在探测到额度恢复后自动解除；
            // 限流是短时 RPM 问题与额度无关；401/433 永久停用需面板手动重新启用（密钥无效/超限不会自愈）
            if (
              key.disableState !== null &&
              key.disableState.reason === "quota_exhausted" &&
              this.hasQuotaRecovered(account)
            ) {
              console.warn(`密钥 ${this.maskKey(key.apiKey)} 额度已恢复，自动重新启用`);
              this.resetKeyHealth(key);
            }
          }
        } catch (error) {
          console.warn(
            `密钥 ${this.maskKey(tokenKeys[0]!.apiKey)} 官网额度查询失败：`,
            error instanceof Error ? error.message : error,
          );
        }
      }),
    );
    if (anySucceeded) {
      this.lastRefreshAt = Date.now();
    }
    // 套餐缓存更新后落盘，重启后无需立即请求官网即可精算重置时间
    this.requestPersist();
  }

  /** 判断官网账户数据是否已恢复额度（套餐有剩余 或 PayGo 有剩余） */
  private hasQuotaRecovered(account: TavilyAccountInfo): boolean {
    if (account.limit > 0 && account.usage < account.limit) {
      return true;
    }
    return account.paygo && account.paygoLimit !== null && account.paygoUsage < account.paygoLimit;
  }

  /** 手动重新启用密钥（面板操作），返回是否成功 */
  reenableKeyById(keyId: string): boolean {
    const key = this.keys.find((item) => this.keyId(item.apiKey) === keyId);
    if (!key) {
      return false;
    }
    this.resetKeyHealth(key);
    return true;
  }

  /**
   * 获取密钥池额度概览（脱敏）。
   * - keys：逐密钥使用情况，id 为密钥指纹用于安全删除。
   *   有 accountToken 的密钥返回实时额度；无 token 的密钥额度字段为 null（前端渲染灰色条）。
   * - accounts：账户级额度列表，按 (plan, usage, limit) 签名去重，仅统计已查到额度的密钥。
   */
  getUsageOverview(): {
    accounts: Array<{ planName: string; planUsage: number; planLimit: number }>;
    keys: Array<{
      id: string;
      apiKeyMasked: string;
      hasAccountToken: boolean;
      email: string | null;
      keyUsage: number | null;
      keyRemaining: number | null;
      planUsage: number | null;
      planLimit: number | null;
      health: KeyHealth;
      disabledNote: string | null;
      disabledUntil: number | null;
      quotaResetAt: number | null;
    }>;
  } {
    const accountMap = new Map<string, { planName: string; planUsage: number; planLimit: number }>();
    const keys = this.keys.map((key) => {
      const info = key.lastAccountInfo;
      const hasToken = key.accountToken !== null;
      if (info) {
        const signature = `${info.planName}|${info.usage}|${info.limit}`;
        accountMap.set(signature, {
          planName: info.planName,
          planUsage: info.usage,
          planLimit: info.limit,
        });
      }
      // 展示层归一：停用状态已过期时（isUsable 已放行）按健康展示，避免面板状态滞后
      const displayState = this.isStateExpired(key.disableState) ? null : key.disableState;
      // limit <= 0 视为无限额度（无上限），剩余显示 null
      const remaining = info && info.limit > 0 ? Math.max(info.limit - info.usage, 0) : null;
      return {
        id: this.keyId(key.apiKey),
        apiKeyMasked: this.maskKey(key.apiKey),
        hasAccountToken: hasToken,
        email: info?.email ?? null,
        keyUsage: info ? info.usage : null,
        keyRemaining: remaining,
        planUsage: info ? info.usage : null,
        planLimit: info ? info.limit : null,
        health: (displayState?.reason ?? "healthy") as KeyHealth,
        disabledNote: displayState?.note ?? null,
        disabledUntil: displayState?.until ?? null,
        quotaResetAt: this.computeNextResetMs(info),
      };
    });
    return { accounts: Array.from(accountMap.values()), keys };
  }

  /** 按密钥指纹删除密钥，返回是否成功 */
  removeKeyById(keyId: string): boolean {
    const index = this.keys.findIndex((key) => this.keyId(key.apiKey) === keyId);
    if (index === -1) {
      return false;
    }
    this.keys.splice(index, 1);
    return true;
  }

  /** 计算密钥指纹（sha256 前 16 位），用于面板安全引用 */
  private keyId(apiKey: string): string {
    return createHash("sha256").update(apiKey).digest("hex").slice(0, KEY_ID_LENGTH);
  }

  /** 脱敏展示：保留前后缀，其余用星号隐藏 */
  private maskKey(apiKey: string): string {
    const prefix = apiKey.slice(0, KEY_MASK_PREFIX_LENGTH);
    const suffix = apiKey.slice(-KEY_MASK_SUFFIX_LENGTH);
    return `${prefix}****${suffix}`;
  }
}

/**
 * 在基准时间基础上增加一个重置周期，返回毫秒时间戳。
 * 支持 daily/weekly/monthly；未知周期返回 null。
 */
export function addCycle(baseMs: number, resetCycle: string): number | null {
  const base = new Date(baseMs);
  switch (resetCycle) {
    case "daily":
      return baseMs + 24 * 60 * 60 * 1000;
    case "weekly":
      return baseMs + 7 * 24 * 60 * 60 * 1000;
    case "monthly": {
      // 按月加一：setMonth 自动处理 31/28/29 号边界（如 1/31 + 1 月 → 3/3）
      const next = new Date(base);
      next.setMonth(next.getMonth() + 1);
      return next.getTime();
    }
    default:
      return null;
  }
}

/** 毫秒时间戳格式化为本地时间字符串（用于面板展示） */
export function formatTime(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 将官网返回的 ISO 时间字符串解析为 UTC 毫秒时间戳。
 * Tavily 的 last_reset 无时区标识（如 "2026-08-01T05:34:43.929000"），
 * 直接 Date.parse 会按服务器本地时区解析导致时区漂移；此处显式按 UTC 解析
 * （无时区标识时补 Z），保证不同时区部署下推算的重置时间一致。
 * 解析失败返回 null。
 */
export function parseIsoUtcMs(iso: string): number | null {
  const hasTimezone = /(Z|[+-]\d{2}:?\d{2})$/.test(iso);
  const normalized = hasTimezone ? iso : `${iso}Z`;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * 从 Tavily 响应中安全提取消耗的 credits（响应体通常为 { usage: { credits: number }, ... }）。
 * 提取失败（结构不符）返回 null，不抛错，避免审计日志干扰正常调用。
 */
function extractCreditsFromResponse(result: unknown): number | null {
  if (typeof result !== "object" || result === null) {
    return null;
  }
  const usage = (result as { usage?: unknown }).usage;
  if (typeof usage !== "object" || usage === null) {
    return null;
  }
  const credits = (usage as { credits?: unknown }).credits;
  return typeof credits === "number" && Number.isFinite(credits) ? credits : null;
}
