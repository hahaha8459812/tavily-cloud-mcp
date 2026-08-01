import type {
  TavilyExtractParams,
  TavilySearchParams,
  TavilyCrawlParams,
} from "./tavily.js";
import { loadConfig, loadApiKeyEntries, type ApiKeyEntry } from "./configStore.js";

/** 从配置文件读取并转换为面板管控的 Search 参数 */
export interface PanelSearchConfig {
  searchDepth?: "advanced" | "basic" | "fast" | "ultra-fast";
  includeAnswer?: boolean | "basic" | "advanced";
  includeRawContent?: boolean | "markdown" | "text";
  includeImages?: boolean;
  includeImageDescriptions?: boolean;
  includeFavicon?: boolean;
  chunksPerSource?: number;
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

/** 校验 include_answer 合法取值（L5：防止 config.json 非法值透传给 Tavily API） */
function isValidIncludeAnswer(value: unknown): boolean {
  return value === true || value === false || value === "basic" || value === "advanced";
}

/** 校验 include_raw_content 合法取值 */
function isValidIncludeRawContent(value: unknown): boolean {
  return value === true || value === false || value === "markdown" || value === "text";
}

/** 校验正整数区间 */
function isValidRangeNumber(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/**
 * Tavily Search country 支持的国家全名白名单（小写，官方枚举）。
 * 注意：必须用完整国家名，不支持 ISO 代码（如 us/cn）；仅 topic=general 时生效。
 */
const SUPPORTED_COUNTRIES = new Set([
  "afghanistan", "albania", "algeria", "andorra", "angola", "argentina", "armenia",
  "australia", "austria", "azerbaijan", "bahamas", "bahrain", "bangladesh", "barbados",
  "belarus", "belgium", "belize", "benin", "bhutan", "bolivia", "bosnia and herzegovina",
  "botswana", "brazil", "brunei", "bulgaria", "burkina faso", "burundi", "cambodia",
  "cameroon", "canada", "cape verde", "central african republic", "chad", "chile", "china",
  "colombia", "comoros", "congo", "costa rica", "croatia", "cuba", "cyprus", "czech republic",
  "denmark", "djibouti", "dominican republic", "ecuador", "egypt", "el salvador",
  "equatorial guinea", "eritrea", "estonia", "ethiopia", "fiji", "finland", "france",
  "gabon", "gambia", "georgia", "germany", "ghana", "greece", "guatemala", "guinea", "haiti",
  "honduras", "hungary", "iceland", "india", "indonesia", "iran", "iraq", "ireland", "israel",
  "italy", "jamaica", "japan", "jordan", "kazakhstan", "kenya", "kuwait", "kyrgyzstan",
  "latvia", "lebanon", "lesotho", "liberia", "libya", "liechtenstein", "lithuania",
  "luxembourg", "madagascar", "malawi", "malaysia", "maldives", "mali", "malta",
  "mauritania", "mauritius", "mexico", "moldova", "monaco", "mongolia", "montenegro",
  "morocco", "mozambique", "myanmar", "namibia", "nepal", "netherlands", "new zealand",
  "nicaragua", "niger", "nigeria", "north korea", "north macedonia", "norway", "oman",
  "pakistan", "panama", "papua new guinea", "paraguay", "peru", "philippines", "poland",
  "portugal", "qatar", "romania", "russia", "rwanda", "saudi arabia", "senegal", "serbia",
  "singapore", "slovakia", "slovenia", "somalia", "south africa", "south korea",
  "south sudan", "spain", "sri lanka", "sudan", "sweden", "switzerland", "syria", "taiwan",
  "tajikistan", "tanzania", "thailand", "togo", "trinidad and tobago", "tunisia", "turkey",
  "turkmenistan", "uganda", "ukraine", "united arab emirates", "united kingdom",
  "united states", "uruguay", "uzbekistan", "venezuela", "vietnam", "yemen", "zambia",
  "zimbabwe",
]);

/** 校验 country 是否为官方支持的国家全名（小写匹配） */
function isValidCountry(value: unknown): boolean {
  return typeof value === "string" && SUPPORTED_COUNTRIES.has(value.trim().toLowerCase());
}

/** 校验 panelSearch 各字段合法取值（L5） */
function isValidPanelSearchValue(key: string, value: unknown): boolean {
  switch (key) {
    case "search_depth":
      return value === "advanced" || value === "basic" || value === "fast" || value === "ultra-fast";
    case "include_answer":
      return isValidIncludeAnswer(value);
    case "include_raw_content":
      return isValidIncludeRawContent(value);
    case "include_images":
    case "include_image_descriptions":
    case "include_favicon":
    case "auto_parameters":
      return typeof value === "boolean";
    case "chunks_per_source":
      // Search 面板参数的 chunks_per_source 官方限制 1-3（Extract 的 1-5 由 AI 参数控制）
      return isValidRangeNumber(value, 1, 3);
    case "country":
      // 官方仅支持国家全名枚举（#5）；非法值会被忽略并告警
      return isValidCountry(value);
    default:
      // include_domains/exclude_domains 已从面板配置移除，改为 web_search 的 AI 参数；
      // 旧 config.json 残留的这两个字段将被忽略
      return false;
  }
}

/** 校验 panelExtractCrawl 各字段合法取值（L5） */
function isValidPanelExtractValue(key: string, value: unknown): boolean {
  switch (key) {
    case "include_images":
    case "include_favicon":
      return typeof value === "boolean";
    case "extract_depth":
      return value === "basic" || value === "advanced";
    case "format":
      return value === "markdown" || value === "text";
    default:
      return false;
  }
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
      // 字段级校验（L5）：非法值跳过并告警，不污染 Tavily 请求
      if (!isValidPanelSearchValue(key, value)) {
        console.warn(`[配置] panelSearch.${key} 的值非法（${JSON.stringify(value)}），已忽略`);
        continue;
      }
      // 面板以 snake_case 存储，转换为内部 camelCase 字段
      const camelKey = toCamelCase(key);
      (config as Record<string, unknown>)[camelKey] = value;
    }
    return config;
  }

  // 兜底：从环境变量读取
  const searchDepth = process.env.TAVILY_SEARCH_DEPTH;
  if (searchDepth === "advanced" || searchDepth === "basic" || searchDepth === "fast" || searchDepth === "ultra-fast") {
    config.searchDepth = searchDepth;
  }

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

  if (panelConfig.searchDepth !== undefined) {
    merged.searchDepth = panelConfig.searchDepth;
  }
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
      // 字段级校验（L5）
      if (!isValidPanelExtractValue(key, value)) {
        console.warn(`[配置] panelExtractCrawl.${key} 的值非法（${JSON.stringify(value)}），已忽略`);
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
