import type {
  TavilyExtractParams,
  TavilySearchParams,
  TavilyCrawlParams,
} from "./tavily.js";
import { loadConfig, loadApiKeyEntries, type ApiKeyEntry } from "./configStore.js";

/** 从配置文件读取并转换为面板管控的 Search 参数 */
export interface PanelSearchConfig {
  includeAnswer?: boolean | "basic" | "advanced";
  includeRawContent?: boolean | "markdown" | "text";
  includeImages?: boolean;
  includeImageDescriptions?: boolean;
  includeFavicon?: boolean;
  chunksPerSource?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  country?: string;
  autoParameters?: boolean;
}

/** 面板管控的 Extract/Crawl 输出偏好参数 */
export interface PanelExtractCrawlConfig {
  includeImages?: boolean;
  includeFavicon?: boolean;
  extractDepth?: "basic" | "advanced";
  format?: "markdown" | "text";
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  return value.toLowerCase() === "true";
}

function parseStringArrayEnv(value: string | undefined): string[] | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseNumberEnv(value: string | undefined): number | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** 将 snake_case 转为 camelCase（如 include_favicon -> includeFavicon） */
function toCamelCase(value: string): string {
  return value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/**
 * 读取 Tavily API Key 条目列表（含可选 accountToken）。
 * 优先级：config.json 的 apiKeys（面板管理，兼容旧 string[] 格式）> 环境变量 TAVILY_API_KEYS > 单个 TAVILY_API_KEY。
 */
export function loadTavilyApiKeyEntries(): ApiKeyEntry[] {
  const configFileEntries = loadApiKeyEntries();
  if (configFileEntries.length > 0) {
    return configFileEntries;
  }
  const multiKeys = parseStringArrayEnv(process.env.TAVILY_API_KEYS);
  if (multiKeys && multiKeys.length > 0) {
    return multiKeys.map((key) => ({ key }));
  }
  const singleKey = process.env.TAVILY_API_KEY ?? "";
  return singleKey ? [{ key: singleKey }] : [];
}

/** 读取 Tavily API Key 明文列表（兼容旧调用方），仅取 key 字段 */
export function loadTavilyApiKeys(): string[] {
  return loadTavilyApiKeyEntries().map((entry) => entry.key);
}

/** 从配置文件（或环境变量兜底）读取面板管控的搜索参数 */
export function loadPanelSearchConfig(): PanelSearchConfig {
  const config: PanelSearchConfig = {};

  // 优先读取 config.json 中面板保存的参数
  const appConfig = loadConfig();
  const saved = appConfig.panelSearch as Record<string, unknown>;
  if (saved && typeof saved === "object" && Object.keys(saved).length > 0) {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined || value === null) {
        continue;
      }
      // 面板以 snake_case 存储，转换为内部 camelCase 字段
      const camelKey = toCamelCase(key);
      (config as Record<string, unknown>)[camelKey] = value;
    }
    return config;
  }

  // 兜底：从环境变量读取
  const includeAnswer = process.env.TAVILY_INCLUDE_ANSWER;
  if (includeAnswer && includeAnswer !== "") {
    config.includeAnswer =
      includeAnswer === "basic" || includeAnswer === "advanced"
        ? includeAnswer
        : includeAnswer.toLowerCase() === "true";
  }

  const includeRawContent = process.env.TAVILY_INCLUDE_RAW_CONTENT;
  if (includeRawContent && includeRawContent !== "") {
    config.includeRawContent =
      includeRawContent === "markdown" || includeRawContent === "text"
        ? includeRawContent
        : includeRawContent.toLowerCase() === "true";
  }

  config.includeImages = parseBooleanEnv(process.env.TAVILY_INCLUDE_IMAGES);
  config.includeImageDescriptions = parseBooleanEnv(
    process.env.TAVILY_INCLUDE_IMAGE_DESCRIPTIONS,
  );
  config.includeFavicon = parseBooleanEnv(process.env.TAVILY_INCLUDE_FAVICON);
  config.chunksPerSource = parseNumberEnv(process.env.TAVILY_CHUNKS_PER_SOURCE);
  config.includeDomains = parseStringArrayEnv(process.env.TAVILY_INCLUDE_DOMAINS);
  config.excludeDomains = parseStringArrayEnv(process.env.TAVILY_EXCLUDE_DOMAINS);
  config.country = process.env.TAVILY_COUNTRY || undefined;
  config.autoParameters = parseBooleanEnv(process.env.TAVILY_AUTO_PARAMETERS);

  return config;
}

/**
 * 把面板管控参数合并进调用参数。
 * 面板参数优先级高于 Tavily 官方默认值，且不被 AI 调用参数覆盖。
 */
export function applyPanelSearchConfig(
  params: TavilySearchParams,
  panelConfig: PanelSearchConfig,
): TavilySearchParams {
  const merged: TavilySearchParams = { ...params };

  if (panelConfig.includeAnswer !== undefined) {
    merged.includeAnswer = panelConfig.includeAnswer;
  }
  if (panelConfig.includeRawContent !== undefined) {
    merged.includeRawContent = panelConfig.includeRawContent;
  }
  if (panelConfig.includeImages !== undefined) {
    merged.includeImages = panelConfig.includeImages;
  }
  if (panelConfig.includeImageDescriptions !== undefined) {
    merged.includeImageDescriptions = panelConfig.includeImageDescriptions;
  }
  if (panelConfig.includeFavicon !== undefined) {
    merged.includeFavicon = panelConfig.includeFavicon;
  }
  if (panelConfig.chunksPerSource !== undefined) {
    merged.chunksPerSource = panelConfig.chunksPerSource;
  }
  if (panelConfig.includeDomains !== undefined) {
    merged.includeDomains = panelConfig.includeDomains;
  }
  if (panelConfig.excludeDomains !== undefined) {
    merged.excludeDomains = panelConfig.excludeDomains;
  }
  if (panelConfig.country !== undefined) {
    merged.country = panelConfig.country;
  }
  if (panelConfig.autoParameters !== undefined) {
    merged.autoParameters = panelConfig.autoParameters;
  }

  return merged;
}

/** 从配置文件（或环境变量兜底）读取面板管控的 Extract/Crawl 输出偏好参数 */
export function loadPanelExtractCrawlConfig(): PanelExtractCrawlConfig {
  const config: PanelExtractCrawlConfig = {};

  // 优先读取 config.json 中面板保存的参数
  const appConfig = loadConfig();
  const saved = appConfig.panelExtractCrawl as Record<string, unknown>;
  if (saved && typeof saved === "object" && Object.keys(saved).length > 0) {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined || value === null) {
        continue;
      }
      const camelKey = toCamelCase(key);
      (config as Record<string, unknown>)[camelKey] = value;
    }
    return config;
  }

  // 兜底：从环境变量读取
  config.includeImages = parseBooleanEnv(process.env.TAVILY_EXTRACT_INCLUDE_IMAGES);
  config.includeFavicon = parseBooleanEnv(process.env.TAVILY_EXTRACT_INCLUDE_FAVICON);

  const extractDepth = process.env.TAVILY_EXTRACT_DEPTH;
  if (extractDepth === "advanced" || extractDepth === "basic") {
    config.extractDepth = extractDepth;
  }

  const format = process.env.TAVILY_EXTRACT_FORMAT;
  if (format === "markdown" || format === "text") {
    config.format = format;
  }

  return config;
}

/** 把面板管控参数合并进 Extract 调用参数 */
export function applyPanelExtractConfig(
  params: TavilyExtractParams,
  panelConfig: PanelExtractCrawlConfig,
): TavilyExtractParams {
  const merged: TavilyExtractParams = { ...params };

  if (panelConfig.includeImages !== undefined) {
    merged.includeImages = panelConfig.includeImages;
  }
  if (panelConfig.includeFavicon !== undefined) {
    merged.includeFavicon = panelConfig.includeFavicon;
  }
  if (panelConfig.extractDepth !== undefined) {
    merged.extractDepth = panelConfig.extractDepth;
  }
  if (panelConfig.format !== undefined) {
    merged.format = panelConfig.format;
  }

  return merged;
}

/** 把面板管控参数合并进 Crawl 调用参数 */
export function applyPanelCrawlConfig(
  params: TavilyCrawlParams,
  panelConfig: PanelExtractCrawlConfig,
): TavilyCrawlParams {
  const merged: TavilyCrawlParams = { ...params };

  if (panelConfig.includeImages !== undefined) {
    merged.includeImages = panelConfig.includeImages;
  }
  if (panelConfig.includeFavicon !== undefined) {
    merged.includeFavicon = panelConfig.includeFavicon;
  }
  if (panelConfig.extractDepth !== undefined) {
    merged.extractDepth = panelConfig.extractDepth;
  }
  if (panelConfig.format !== undefined) {
    merged.format = panelConfig.format;
  }

  return merged;
}
