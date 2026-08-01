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

/** 统一的 API 请求封装：自动携带 token，错误时抛出可读信息 */
async function request<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = getToken();
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
    // 401 未授权时清掉 token，交由路由层跳转登录
    if (response.status === 401 && path !== "/login") {
      clearToken();
    }
    const error = new Error((body as { error?: string }).error ?? `请求失败：HTTP ${response.status}`);
    (error as { status?: number }).status = response.status;
    throw error;
  }

  return body as T;
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
  health: string;
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
}

export interface StatusResponse extends PanelConfig {
  keyCount: number;
  keys: KeyUsageItem[];
  accounts: AccountUsageItem[];
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
  refreshUsage: () =>
    request<{ ok: boolean; keys: KeyUsageItem[]; accounts: AccountUsageItem[] }>("/refresh-usage", {
      method: "POST",
    }),
  getConfig: () => request<PanelConfig>("/config"),
  saveConfig: (
    panelSearch: Record<string, unknown>,
    panelExtractCrawl: Record<string, unknown>,
    mcpAuth?: McpAuthConfig,
  ) =>
    request<{ ok: boolean }>("/config", {
      method: "PUT",
      body: mcpAuth ? { panelSearch, panelExtractCrawl, mcpAuth } : { panelSearch, panelExtractCrawl },
    }),
  changePassword: (oldPassword: string, newPassword: string) =>
    request<{ ok: boolean }>("/password", {
      method: "POST",
      body: { oldPassword, newPassword },
    }),
};
