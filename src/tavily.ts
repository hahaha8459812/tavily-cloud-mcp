const TAVILY_API_BASE_URL = "https://api.tavily.com";

/** Tavily API 请求客户端超时（毫秒），防止上游挂起导致调用永久阻塞 */
const TAVILY_REQUEST_TIMEOUT_MS = 30_000;

export type SearchDepth = "advanced" | "basic" | "fast" | "ultra-fast";
export type SearchTopic = "general" | "news" | "finance";
export type TimeRange = "day" | "week" | "month" | "year" | "d" | "w" | "m" | "y";

export interface TavilySearchParams {
  query: string;
  maxResults?: number;
  searchDepth?: SearchDepth;
  topic?: SearchTopic;
  timeRange?: TimeRange;
  startDate?: string;
  endDate?: string;
  exactMatch?: boolean;
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

export interface TavilyExtractParams {
  urls: string | string[];
  query?: string;
  chunksPerSource?: number;
  extractDepth?: "basic" | "advanced";
  includeImages?: boolean;
  includeFavicon?: boolean;
  format?: "markdown" | "text";
  timeout?: number;
  includeUsage?: boolean;
}

export interface TavilyCrawlParams {
  url: string;
  instructions?: string;
  chunksPerSource?: number;
  maxDepth?: number;
  maxBreadth?: number;
  limit?: number;
  selectPaths?: string[];
  selectDomains?: string[];
  excludePaths?: string[];
  excludeDomains?: string[];
  allowExternal?: boolean;
  includeImages?: boolean;
  extractDepth?: "basic" | "advanced";
  format?: "markdown" | "text";
  includeFavicon?: boolean;
  timeout?: number;
  includeUsage?: boolean;
}

export interface TavilyMapParams {
  url: string;
  instructions?: string;
  maxDepth?: number;
  maxBreadth?: number;
  limit?: number;
  selectPaths?: string[];
  selectDomains?: string[];
  excludePaths?: string[];
  excludeDomains?: string[];
  allowExternal?: boolean;
  timeout?: number;
  includeUsage?: boolean;
}

export interface TavilyResearchParams {
  input: string;
  model?: "mini" | "pro" | "auto";
  outputSchema?: Record<string, unknown>;
  citationFormat?: "numbered" | "mla" | "apa" | "chicago";
  includeDomains?: string[];
  excludeDomains?: string[];
  outputLength?: "short" | "standard" | "long";
}

export interface TavilyImage {
  url: string;
  description?: string;
}

export interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
  raw_content?: string;
  favicon?: string;
  images?: TavilyImage[];
}

export interface TavilySearchResponse {
  query: string;
  answer?: string;
  images?: TavilyImage[];
  results: TavilySearchResult[];
  usage?: { credits: number };
  request_id?: string;
}

export interface TavilyExtractItem {
  url: string;
  title?: string;
  raw_content: string;
  images?: string[];
  favicon?: string;
}

export interface TavilyExtractResponse {
  results: TavilyExtractItem[];
  failed_results: { url: string; error: string }[];
  response_time?: number;
  usage?: { credits: number };
  request_id?: string;
}

export interface TavilyCrawlResponse {
  base_url: string;
  results: { url: string; raw_content: string; favicon?: string }[];
  response_time?: number;
  usage?: { credits: number };
  request_id?: string;
}

export interface TavilyMapResponse {
  base_url: string;
  results: string[];
  response_time?: number;
  usage?: { credits: number };
  request_id?: string;
}

export interface TavilyResearchCreatedResponse {
  request_id: string;
  created_at: string;
  status: string;
  input: string;
  model: string;
  response_time?: number;
}

export interface TavilyResearchStatusResponse {
  request_id: string;
  created_at?: string;
  status: string;
  content?: string | Record<string, unknown>;
  sources?: { title: string; url: string; favicon?: string }[];
  response_time?: number;
}

/** 官网 /api/account 返回的实时账户额度（带 appSession token 查询） */
export interface TavilyAccountInfo {
  email: string;
  usage: number;
  limit: number;
  planName: string;
}

/** 官网 /api/account 响应解析结果，附带回写的新 token（用于自动续期） */
export interface AccountInfoWithToken {
  account: TavilyAccountInfo;
  newToken: string | null;
}

export class TavilyClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number | null,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "TavilyClientError";
  }
}

export class TavilyClient {
  constructor(private readonly apiKey: string) {
    if (!apiKey) {
      throw new Error("Tavily API Key 不能为空");
    }
  }

  private async requestJson(
    path: string,
    options: { method?: string; body?: unknown } = {},
  ): Promise<unknown> {
    const response = await fetch(`${TAVILY_API_BASE_URL}${path}`, {
      method: options.method ?? "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(TAVILY_REQUEST_TIMEOUT_MS),
    });

    const responseBody = await response.text();

    if (!response.ok) {
      throw new TavilyClientError(
        `Tavily API 请求失败：HTTP ${response.status}`,
        response.status,
        responseBody,
      );
    }

    return responseBody ? JSON.parse(responseBody) : null;
  }

  async search(params: TavilySearchParams): Promise<TavilySearchResponse> {
    return (await this.requestJson("/search", {
      body: {
        query: params.query,
        // 兜底默认值：工具层的 zod schema 已定义默认值，
        // 此处保留默认以兼容不经工具层直接调用本客户端的情况
        max_results: params.maxResults ?? 5,
        search_depth: params.searchDepth ?? "basic",
        topic: params.topic,
        time_range: params.timeRange,
        start_date: params.startDate,
        end_date: params.endDate,
        exact_match: params.exactMatch,
        include_answer: params.includeAnswer,
        include_raw_content: params.includeRawContent,
        include_images: params.includeImages,
        include_image_descriptions: params.includeImageDescriptions,
        include_favicon: params.includeFavicon,
        chunks_per_source: params.chunksPerSource,
        include_domains: params.includeDomains,
        exclude_domains: params.excludeDomains,
        country: params.country,
        auto_parameters: params.autoParameters,
      },
    })) as TavilySearchResponse;
  }

  async extract(params: TavilyExtractParams): Promise<TavilyExtractResponse> {
    return (await this.requestJson("/extract", {
      body: {
        urls: params.urls,
        query: params.query,
        chunks_per_source: params.chunksPerSource,
        extract_depth: params.extractDepth ?? "basic",
        include_images: params.includeImages,
        include_favicon: params.includeFavicon,
        format: params.format ?? "markdown",
        timeout: params.timeout,
        include_usage: params.includeUsage,
      },
    })) as TavilyExtractResponse;
  }

  async crawl(params: TavilyCrawlParams): Promise<TavilyCrawlResponse> {
    return (await this.requestJson("/crawl", {
      body: {
        url: params.url,
        instructions: params.instructions,
        chunks_per_source: params.chunksPerSource,
        max_depth: params.maxDepth,
        max_breadth: params.maxBreadth,
        limit: params.limit,
        select_paths: params.selectPaths,
        select_domains: params.selectDomains,
        exclude_paths: params.excludePaths,
        exclude_domains: params.excludeDomains,
        allow_external: params.allowExternal,
        include_images: params.includeImages,
        extract_depth: params.extractDepth,
        format: params.format,
        include_favicon: params.includeFavicon,
        timeout: params.timeout,
        include_usage: params.includeUsage,
      },
    })) as TavilyCrawlResponse;
  }

  async map(params: TavilyMapParams): Promise<TavilyMapResponse> {
    return (await this.requestJson("/map", {
      body: {
        url: params.url,
        instructions: params.instructions,
        max_depth: params.maxDepth,
        max_breadth: params.maxBreadth,
        limit: params.limit,
        select_paths: params.selectPaths,
        select_domains: params.selectDomains,
        exclude_paths: params.excludePaths,
        exclude_domains: params.excludeDomains,
        allow_external: params.allowExternal,
        timeout: params.timeout,
        include_usage: params.includeUsage,
      },
    })) as TavilyMapResponse;
  }

  /** 创建研究任务，返回 request_id（异步，需轮询状态） */
  async createResearch(params: TavilyResearchParams): Promise<TavilyResearchCreatedResponse> {
    return (await this.requestJson("/research", {
      body: {
        input: params.input,
        model: params.model,
        output_schema: params.outputSchema,
        citation_format: params.citationFormat,
        include_domains: params.includeDomains,
        exclude_domains: params.excludeDomains,
        output_length: params.outputLength,
      },
    })) as TavilyResearchCreatedResponse;
  }

  /** 查询研究任务状态：200=完成/失败，202=处理中 */
  async getResearchStatus(requestId: string): Promise<TavilyResearchStatusResponse> {
    const response = await fetch(
      `${TAVILY_API_BASE_URL}/research/${encodeURIComponent(requestId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: AbortSignal.timeout(TAVILY_REQUEST_TIMEOUT_MS),
      },
    );

    const responseBody = await response.text();

    if (!response.ok && response.status !== 202) {
      throw new TavilyClientError(
        `Tavily 研究任务查询失败：HTTP ${response.status}`,
        response.status,
        responseBody,
      );
    }

    return JSON.parse(responseBody) as TavilyResearchStatusResponse;
  }
}

/** 用官网 appSession token 查询实时账户额度（绕过公共 /usage 接口的计费周期滞后问题） */
export async function getAccountUsageByToken(
  appSessionToken: string,
): Promise<AccountInfoWithToken> {
  const response = await fetch("https://app.tavily.com/api/account", {
    method: "GET",
    headers: {
      Cookie: `appSession=${appSessionToken}`,
    },
    signal: AbortSignal.timeout(TAVILY_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new TavilyClientError(
      `官网账户额度查询失败：HTTP ${response.status}`,
      response.status,
      await response.text(),
    );
  }

  const body = (await response.json()) as {
    usage?: number;
    limit?: number;
    current_plan?: string;
    plan_display_name?: string;
    email?: string;
  };

  // 捕获 Set-Cookie 中的新 appSession，用于自动续期
  let newToken: string | null = null;
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) {
    const match = /appSession=([^;]+)/.exec(setCookie);
    if (match?.[1]) {
      newToken = match[1];
    }
  }

  return {
    account: {
      email: body.email ?? "",
      usage: body.usage ?? 0,
      limit: body.limit ?? 0,
      planName: body.plan_display_name ?? body.current_plan ?? "unknown",
    },
    newToken,
  };
}
