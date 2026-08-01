import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 配置文件默认路径：项目根目录下的 config.json（可通过环境变量覆盖） */
export const CONFIG_FILE_PATH =
  process.env.CONFIG_FILE ?? path.resolve(__dirname, "..", "config.json");

/** 管理员账号凭据（明文密码仅用于本地部署；生产环境建议改用外部密钥管理） */
export interface AdminCredentials {
  username: string;
  password: string;
}

/**
 * 池内密钥条目。
 * accountToken 为官网 appSession JWT（可选），用于通过官网 /api/account 实时查询额度；
 * 未配置时该 key 不展示额度，仅正常参与轮询调用。
 */
export interface ApiKeyEntry {
  key: string;
  accountToken?: string;
}

/** config.json 的完整结构 */
export interface AppConfig {
  admin: AdminCredentials;
  /** 池内密钥列表（面板管理），可能为旧格式 string[]，读取时统一兼容 */
  apiKeys?: ApiKeyEntry[] | string[];
  /** 面板管控的 Search 参数（对应 config.ts 的 PanelSearchConfig 字段） */
  panelSearch: Record<string, unknown>;
  /** 面板管控的 Extract/Crawl 参数（对应 config.ts 的 PanelExtractCrawlConfig 字段） */
  panelExtractCrawl: Record<string, unknown>;
}

const DEFAULT_CONFIG: AppConfig = {
  admin: {
    username: "admin",
    password: "admin123",
  },
  panelSearch: {},
  panelExtractCrawl: {},
};

/**
 * 读取配置文件，文件不存在或损坏时返回默认配置。
 * 面板写入配置后，后续调用都走内存中的最新值。
 */
export function loadConfig(): AppConfig {
  try {
    const raw = readFileSync(CONFIG_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    return {
      admin: parsed.admin ?? DEFAULT_CONFIG.admin,
      panelSearch: parsed.panelSearch ?? {},
      panelExtractCrawl: parsed.panelExtractCrawl ?? {},
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/** 读取配置中的密钥列表，兼容旧格式（纯字符串数组）与新格式（{key, accountToken} 数组） */
export function loadApiKeyEntries(): ApiKeyEntry[] {
  const appConfig = loadConfig() as AppConfig & { apiKeys?: ApiKeyEntry[] | string[] };
  const rawEntries = appConfig.apiKeys ?? [];
  return rawEntries.map((entry) =>
    typeof entry === "string" ? { key: entry } : { key: entry.key, accountToken: entry.accountToken },
  );
}

/** 将配置写入文件，目录不存在时自动创建 */
export function saveConfig(config: AppConfig): void {
  mkdirSync(path.dirname(CONFIG_FILE_PATH), { recursive: true });
  writeFileSync(CONFIG_FILE_PATH, JSON.stringify(config, null, 2), "utf8");
}

/** 对密码做 sha256 哈希，用于登录校验，避免明文比较 */
export function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}
