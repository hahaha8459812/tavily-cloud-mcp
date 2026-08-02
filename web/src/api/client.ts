const TOKEN_KEY = "tavily_admin_token";
const PASSWORD_KEY = "tavily_admin_password";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * 面板密码持久化（个人项目：记住密码，打开面板自动登录）。
 * 注意：密码明文存 localStorage，仅适用于本机/局域网自用场景。
 */
export function getSavedPassword(): string | null {
  return localStorage.getItem(PASSWORD_KEY);
}

export function setSavedPassword(password: string): void {
  localStorage.setItem(PASSWORD_KEY, password);
}

export function clearSavedPassword(): void {
  localStorage.removeItem(PASSWORD_KEY);
}

/** 统一的 API 请求封装：自动携带 token，401 时自动续登并重放请求，错误时抛出可读信息 */
async function request<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const execute = async (token: string | null): Promise<T> => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`/api${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    const text = await response.text();
    const body = text ? JSON.parse(text) : {};

    if (!response.ok) {
      const error = new Error((body as { error?: string }).error ?? `请求失败：HTTP ${response.status}`);
      (error as { status?: number }).status = response.status;
      throw error;
    }

    return body as T;
  };

  try {
    return await execute(getToken());
  } catch (error) {
    const status = (error as { status?: number }).status;
    // 非 401（或登录接口自身失败）直接抛出
    if (status !== 401 || path === "/login") {
      throw error;
    }

    // 401 会话失效：尝试用记住的密码静默重登，成功后重放原请求（无需用户重新登录）
    const newToken = await reLoginWithSavedPassword();
    if (newToken) {
      try {
        return await execute(newToken);
      } catch (retryError) {
        // 重登后仍 401（极端：token 立即失效）则彻底清理
        if ((retryError as { status?: number }).status === 401) {
          clearToken();
          notifySessionExpired();
        }
        throw retryError;
      }
    }

    // 无记住密码或重登失败：清理状态并通知跳转登录页
    clearToken();
    notifySessionExpired();
    throw error;
  }
}

/** 会话失效事件：路由层监听后跳转登录页 */
export const SESSION_EXPIRED_EVENT = "tavily:session-expired";
export function notifySessionExpired(): void {
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
}

/** 进行中的自动重登 promise（并发 401 只触发一次重登） */
let reLoginInFlight: Promise<string | null> | null = null;

/** 用记住的密码重新登录并更新 token；无记住密码或失败返回 null */
async function reLoginWithSavedPassword(): Promise<string | null> {
  if (reLoginInFlight) {
    return reLoginInFlight;
  }
  reLoginInFlight = (async () => {
    const savedPassword = getSavedPassword();
    if (!savedPassword) {
      return null;
    }
    try {
      const { token } = await api.login(savedPassword);
      setToken(token);
      return token;
    } catch {
      // 密码已失效
      clearSavedPassword();
      return null;
    }
  })().finally(() => {
    reLoginInFlight = null;
  });
  return reLoginInFlight;
}

export interface LoginResponse {
  token: string;
}

export interface KeyUsageItem {
  id: string;
  apiKeyMasked: string;
  hasAccountToken: boolean;
  email: string | null;
  keyUsage: number | null;
  keyRemaining: number | null;
  planUsage: number | null;
  planLimit: number | null;
  health: 'healthy' | 'rate_limited' | 'quota_exhausted' | 'disabled';
  disabledNote: string | null;
  disabledUntil: number | null;
  quotaResetAt: number | null;
}

/** 账户级额度（按 Tavily 账户签名去重，同一账户多 key 只统计一次） */
export interface AccountUsageItem {
  planName: string;
  planUsage: number;
  planLimit: number;
}

export interface McpAuthConfig {
  enabled: boolean;
  apiKey: string;
}

export interface PanelConfig {
  panelSearch: Record<string, unknown>;
  panelExtractCrawl: Record<string, unknown>;
  mcpAuth: McpAuthConfig;
  researchEnabled: boolean;
}

export interface StatusResponse extends PanelConfig {
  keyCount: number;
  keys: KeyUsageItem[];
  accounts: AccountUsageItem[];
}

/** 单条 MCP 调用记录（内存缓冲，不持久化） */
export interface CallLogEntry {
  id: number
  tool: string
  keyMasked: string
  costMs: number
  credits: number | null
  success: boolean
  error: string | null
  at: number
}

export interface CallLogResponse {
  entries: CallLogEntry[]
  maxEntries: number
}

export const api = {
  login: (password: string) =>
    request<LoginResponse>("/login", { method: "POST", body: { password } }),
  status: (refresh = false) =>
    request<StatusResponse>(`/status${refresh ? "?refresh=1" : ""}`),
  addKey: (apiKey: string, accountToken?: string) =>
    request<{ ok: boolean; keyCount: number }>("/keys", {
      method: "POST",
      body: { apiKey, accountToken },
    }),
  updateKeyToken: (keyId: string, accountToken: string) =>
    request<{ ok: boolean }>("/keys/token", {
      method: "PUT",
      body: { id: keyId, accountToken },
    }),
  removeKey: (keyId: string) =>
    request<{ ok: boolean; keyCount: number }>(`/keys?id=${encodeURIComponent(keyId)}`, {
      method: "DELETE",
    }),
  reenableKey: (keyId: string) =>
    request<{ ok: boolean }>("/keys/re-enable", {
      method: "POST",
      body: { id: keyId },
    }),
  refreshUsage: () =>
    request<{ ok: boolean; keys: KeyUsageItem[]; accounts: AccountUsageItem[] }>("/refresh-usage", {
      method: "POST",
    }),
  getConfig: () => request<PanelConfig>("/config"),
  saveConfig: (
    panelSearch: Record<string, unknown>,
    panelExtractCrawl: Record<string, unknown>,
    mcpAuth?: McpAuthConfig,
    researchEnabled?: boolean,
  ) =>
    request<{ ok: boolean }>("/config", {
      method: "PUT",
      body:
        mcpAuth || researchEnabled !== undefined
          ? { panelSearch, panelExtractCrawl, mcpAuth, researchEnabled }
          : { panelSearch, panelExtractCrawl },
    }),
  changePassword: (oldPassword: string, newPassword: string) =>
    request<{ ok: boolean }>("/password", {
      method: "POST",
      body: { oldPassword, newPassword },
    }),
  getCallLogs: () => request<CallLogResponse>("/call-logs"),
  setCallLogMaxEntries: (maxEntries: number) =>
    request<{ ok: boolean; maxEntries: number }>("/call-logs/config", {
      method: "PUT",
      body: { maxEntries },
    }),
};
