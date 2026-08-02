/**
 * MCP 调用记录内存缓冲。
 * 仅保存在容器内存中，重启即清空（不做磁盘持久化）。
 * 环形缓冲：超过上限时丢弃最旧记录，防止内存无限增长。
 */
export interface CallLogEntry {
  id: number;
  /** 工具名（如 web_search / web_extract） */
  tool: string;
  /** 实际使用的密钥指纹（脱敏展示，如 tvly-dev****DnKd） */
  keyMasked: string;
  /** 调用耗时（毫秒） */
  costMs: number;
  /** 消耗 credits；Tavily 未返回时（如 web_search）为 null */
  credits: number | null;
  /** 是否成功 */
  success: boolean;
  /** 失败原因；成功时为 null */
  error: string | null;
  /** 调用发生时间戳（毫秒） */
  at: number;
}

/** 调用记录条数上限（可在面板调整并持久化到 config.json） */
export const DEFAULT_MAX_ENTRIES = 200;
export const MAX_LIMIT = 1000;
export const MIN_LIMIT = 10;

export class CallLog {
  private entries: CallLogEntry[] = [];
  private nextId = 1;
  private maxEntries: number;

  /**
   * @param persistedMaxEntries 从 config.json 读取的持久化上限；
   *   非法或缺失时回退默认值 200
   */
  constructor(persistedMaxEntries: unknown) {
    this.maxEntries =
      typeof persistedMaxEntries === "number" &&
      Number.isInteger(persistedMaxEntries) &&
      persistedMaxEntries >= MIN_LIMIT &&
      persistedMaxEntries <= MAX_LIMIT
        ? persistedMaxEntries
        : DEFAULT_MAX_ENTRIES;
  }

  /** 记录一次调用 */
  add(entry: Omit<CallLogEntry, "id" | "at">): void {
    this.entries.push({ ...entry, id: this.nextId++, at: Date.now() });
    if (this.entries.length > this.maxEntries) {
      // 丢弃最旧的记录，保持缓冲不超过上限
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
  }

  /** 读取最近记录（新→旧），默认取全部缓冲内的记录 */
  getRecent(): CallLogEntry[] {
    return [...this.entries].reverse();
  }

  /** 当前条数上限 */
  getMaxEntries(): number {
    return this.maxEntries;
  }

  /**
   * 设置条数上限并立即裁剪超出部分。
   * 仅修改内存值；持久化到 config.json 由调用方（adminApi）负责。
   * 非法值返回 false。
   */
  setMaxEntries(limit: number): boolean {
    if (!Number.isInteger(limit) || limit < MIN_LIMIT || limit > MAX_LIMIT) {
      return false;
    }
    this.maxEntries = limit;
    // 若新上限小于当前缓冲大小，立即裁剪
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
    return true;
  }

  /** 当前缓冲内记录数 */
  get size(): number {
    return this.entries.length;
  }
}
