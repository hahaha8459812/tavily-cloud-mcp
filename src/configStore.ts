import { readFileSync, writeFileSync, renameSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 配置文件默认路径：项目根目录下的 config.json（可通过环境变量覆盖） */
export const CONFIG_FILE_PATH =
  process.env.CONFIG_FILE ?? path.resolve(__dirname, "..", "config.json");

/** config 文件缓存：mtime 变化时自动失效（L6），避免每次工具调用同步读盘 */
let configCache: { mtimeMs: number; config: AppConfig } | null = null;

/** 管理员账号凭据（password 存储为 scrypt 哈希，旧明文会在保存时自动迁移） */
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

/** scrypt 哈希前缀，用于识别新版密码格式 */
const SCRYPT_PREFIX = "scrypt$";
/** sha256 哈希长度（旧版格式，兼容校验用） */
const SHA256_HEX_LENGTH = 64;

const DEFAULT_CONFIG: AppConfig = {
  admin: {
    username: "admin",
    password: "admin123",
  },
  panelSearch: {},
  panelExtractCrawl: {},
};

/**
 * 读取配置文件。
 * 保留 apiKeys 字段（H5 修复）：面板保存参数/改密走"读全量→改字段→写回"时不会丢密钥。
 * 文件不存在时返回默认配置（视为首次部署）；文件损坏时打告警日志并返回默认配置，
 * 避免静默以默认凭据对外服务而无人察觉（H2）。
 */
export function loadConfig(): AppConfig {
  // 缓存命中（mtime 未变）直接返回，避免每次工具调用同步读盘（L6）
  if (configCache) {
    try {
      const currentMtime = statSync(CONFIG_FILE_PATH).mtimeMs;
      if (currentMtime === configCache.mtimeMs) {
        return configCache.config;
      }
    } catch {
      // statSync 失败（文件被删）则当作首次读取
    }
  }

  try {
    const raw = readFileSync(CONFIG_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    const config: AppConfig = {
      admin: parsed.admin ?? DEFAULT_CONFIG.admin,
      apiKeys: parsed.apiKeys,
      panelSearch: parsed.panelSearch ?? {},
      panelExtractCrawl: parsed.panelExtractCrawl ?? {},
    };
    try {
      configCache = { mtimeMs: statSync(CONFIG_FILE_PATH).mtimeMs, config };
    } catch {
      configCache = null;
    }
    return config;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      // 文件不存在：首次部署，静默返回默认配置即可
      return { ...DEFAULT_CONFIG };
    }
    console.error(
      `[严重] 配置文件 ${CONFIG_FILE_PATH} 读取失败（${error instanceof Error ? error.message : String(error)}），` +
        "已回退到默认配置。若使用了默认密码 admin123 请立即修改，并检查配置文件权限与内容。",
    );
    return { ...DEFAULT_CONFIG };
  }
}

/** 读取配置中的密钥列表，兼容旧格式（纯字符串数组）与新格式（{key, accountToken} 数组） */
export function loadApiKeyEntries(): ApiKeyEntry[] {
  const appConfig = loadConfig();
  const rawEntries = appConfig.apiKeys ?? [];
  return rawEntries.map((entry) =>
    typeof entry === "string" ? { key: entry } : { key: entry.key, accountToken: entry.accountToken },
  );
}

/**
 * 将配置写入文件（尝试原子写入 + 私有权限）。
 * 先写临时文件再 rename；若目标为 Docker 挂载卷等 rename 不原子的环境，
 * rename 失败时回退为直接写目标文件，保证功能可用（H4/M7）。
 */
export function saveConfig(config: AppConfig): void {
  mkdirSync(path.dirname(CONFIG_FILE_PATH), { recursive: true });
  const content = JSON.stringify(config, null, 2);
  try {
    const tmpPath = `${CONFIG_FILE_PATH}.tmp`;
    writeFileSync(tmpPath, content, { encoding: "utf8", mode: 0o600 });
    renameSync(tmpPath, CONFIG_FILE_PATH);
  } catch (error) {
    // 挂载卷/文件系统不支持原子 rename 时回退为直接写入
    console.warn(
      `原子写入 config.json 失败（${error instanceof Error ? error.message : String(error)}），回退为直接写入`,
    );
    writeFileSync(CONFIG_FILE_PATH, content, { encoding: "utf8", mode: 0o600 });
  }
  // 写入后使缓存失效，保证下次 loadConfig 读到最新值（L6）
  configCache = null;
}

/**
 * 对密码生成 scrypt 哈希（随机盐 + 工作因子）。
 * 格式：scrypt$<salt_hex>$<hash_hex>
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 32).toString("hex");
  return `${SCRYPT_PREFIX}${salt}$${hash}`;
}

/**
 * 校验密码与存储值是否匹配。
 * 兼容三种存储格式：
 * - 新版 scrypt 哈希（优先）
 * - 旧版无盐 sha256（64 位 hex）
 * - 明文（历史遗留，初次保存时会自动迁移为 scrypt）
 */
export function verifyPassword(password: string, stored: string): boolean {
  if (stored.startsWith(SCRYPT_PREFIX)) {
    const parts = stored.slice(SCRYPT_PREFIX.length).split("$");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return false;
    }
    const [salt, expectedHash] = parts;
    const actualHash = crypto.scryptSync(password, salt, 32).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(actualHash, "hex"), Buffer.from(expectedHash, "hex"));
  }
  if (stored.length === SHA256_HEX_LENGTH && /^[0-9a-f]{64}$/i.test(stored)) {
    const actualHash = crypto.createHash("sha256").update(password).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(actualHash, "hex"), Buffer.from(stored, "hex"));
  }
  // 明文（历史遗留）
  return stored === password;
}

/** 判断存储的密码是否需要迁移为 scrypt（旧明文/sha256 时为 true） */
export function isPasswordOutdated(stored: string): boolean {
  return !stored.startsWith(SCRYPT_PREFIX);
}
