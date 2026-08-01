import {
  TavilyClient,
  TavilyClientError,
  getAccountUsageByToken,
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

/** 密钥在池中的健康状态 */
type KeyHealth = "healthy" | "temporarily_disabled";

interface PooledKey {
  apiKey: string;
  client: TavilyClient;
  health: KeyHealth;
  /** 临时禁用截止时间（毫秒时间戳），disableUntil 为 0 表示未禁用 */
  disabledUntil: number;
  /** 连续失败的次数，达到阈值后触发临时禁用 */
  consecutiveFailures: number;
  /** 官网 appSession token（可选），用于实时额度查询；未配置则无额度展示 */
  accountToken: string | null;
  /** 最近一次官网账户额度查询结果（可能为 null 表示未知） */
  lastAccountInfo: {
    email: string;
    usage: number;
    limit: number;
    planName: string;
  } | null;
}

const DISABLE_DURATION_MS = 60_000;
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * 多密钥轮询池。
 * - 按 round-robin 顺序选择健康密钥
 * - 401/429/432/433 等限流或鉴权错误触发临时禁用并自动切换到下一个密钥
 * - 缓存各密钥额度状态，供 get_key_usage 工具使用
 */
export class TavilyKeyPool {
  private keys: PooledKey[];
  private nextIndex = 0;

  constructor(apiKeyEntries: Array<ApiKeyEntry | string>) {
    this.keys = [];
    for (const entry of apiKeyEntries) {
      const apiKey = typeof entry === "string" ? entry : entry.key;
      const accountToken = typeof entry === "string" ? null : (entry.accountToken ?? null);
      this.addKey(apiKey, accountToken);
    }
  }

  /** 池内密钥数量 */
  get size(): number {
    return this.keys.length;
  }

  /** 新增一个密钥到池中，返回是否成功（重复或格式不合法不添加）；accountToken 可选 */
  addKey(apiKey: string, accountToken: string | null = null): boolean {
    const trimmed = apiKey.trim();
    // Tavily API Key 以 tvly- 开头；格式校验失败时面板会收到明确错误
    if (!trimmed.startsWith("tvly-") || trimmed.length < 12) {
      return false;
    }
    if (this.keys.some((key) => key.apiKey === trimmed)) {
      return false;
    }
    this.keys.push({
      apiKey: trimmed,
      client: new TavilyClient(trimmed),
      health: "healthy",
      disabledUntil: 0,
      consecutiveFailures: 0,
      accountToken: accountToken && accountToken.trim().length > 0 ? accountToken.trim() : null,
      lastAccountInfo: null,
    });
    return true;
  }

  /** 从池中移除指定密钥，返回是否成功 */
  removeKey(apiKey: string): boolean {
    const index = this.keys.findIndex((key) => key.apiKey === apiKey);
    if (index === -1) {
      return false;
    }
    this.keys.splice(index, 1);
    return true;
  }

  /** 获取全部密钥条目（含 accountToken，供持久化到 config.json，注意敏感） */
  getRawKeyEntries(): Array<{ key: string; accountToken: string | null }> {
    return this.keys.map((key) => ({ key: key.apiKey, accountToken: key.accountToken }));
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

  private isUsable(key: PooledKey): boolean {
    if (key.health === "temporarily_disabled") {
      return Date.now() >= key.disabledUntil;
    }
    return true;
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

  /** 临时禁用某个密钥，并记录失败次数 */
  private disableKey(key: PooledKey): void {
    key.consecutiveFailures += 1;
    if (key.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      key.health = "temporarily_disabled";
      key.disabledUntil = Date.now() + DISABLE_DURATION_MS;
      key.consecutiveFailures = 0;
      console.warn(
        `密钥 ${this.maskKey(key.apiKey)} 连续失败 ${MAX_CONSECUTIVE_FAILURES} 次，临时禁用 60 秒`,
      );
    }
  }

  private resetKeyHealth(key: PooledKey): void {
    key.health = "healthy";
    key.disabledUntil = 0;
    key.consecutiveFailures = 0;
  }

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

  /**
   * 在密钥池上执行一次带故障转移的 Tavily 调用。
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

    for (let round = 0; round < this.keys.length; round++) {
      const key = this.pickNextUsableKey();
      if (!key) {
        break;
      }
      if (attempted.has(key)) {
        continue;
      }
      attempted.add(key);

      try {
        const result = await operation(key.client);
        this.resetKeyHealth(key);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (this.isFailoverableError(error)) {
          console.warn(
            `密钥 ${this.maskKey(key.apiKey)} ${operationName}返回可转移错误：${lastError.message}，切换到下一个密钥`,
          );
          this.disableKey(key);
          continue;
        }
        throw error;
      }
    }

    const message = lastError
      ? `所有密钥均不可用：${lastError.message}`
      : "密钥池中无可用密钥";
    throw new Error(message);
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
   * 刷新所有配置了 accountToken 的密钥额度状态。
   * 每次调用官网 /api/account 时会捕获 Set-Cookie 中的新 appSession 并回写内存，
   * 由调用方负责持久化到 config.json（实现自动续期）。
   * 无 token 的密钥跳过（额度数据保持未知）。
   */
  async refreshUsage(): Promise<void> {
    await Promise.all(
      this.keys.map(async (key) => {
        if (!key.accountToken || !this.isUsable(key)) {
          return;
        }
        try {
          const { account, newToken } = await getAccountUsageByToken(key.accountToken);
          key.lastAccountInfo = account;
          if (newToken && newToken !== key.accountToken) {
            key.accountToken = newToken;
          }
        } catch (error) {
          console.warn(
            `密钥 ${this.maskKey(key.apiKey)} 官网额度查询失败：`,
            error instanceof Error ? error.message : error,
          );
        }
      }),
    );
  }

  /** 返回所有已配置 accountToken 的密钥条目（供自动续期后持久化） */
  getTokenizedKeyEntries(): Array<{ key: string; accountToken: string }> {
    return this.keys
      .filter((key) => key.accountToken !== null)
      .map((key) => ({ key: key.apiKey, accountToken: key.accountToken! }));
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
      return {
        id: this.keyId(key.apiKey),
        apiKeyMasked: this.maskKey(key.apiKey),
        hasAccountToken: hasToken,
        email: info?.email ?? null,
        keyUsage: info ? info.usage : null,
        keyRemaining: info ? Math.max(info.limit - info.usage, 0) : null,
        planUsage: info ? info.usage : null,
        planLimit: info ? info.limit : null,
        health: key.health,
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
    return createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
  }

  /** 脱敏展示：保留前 8 位，其余用星号隐藏 */
  private maskKey(apiKey: string): string {
    const prefix = apiKey.slice(0, 8);
    const suffix = apiKey.slice(-4);
    return `${prefix}****${suffix}`;
  }
}
