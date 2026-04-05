export type JsonRequest = (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;

export function createRequest(getBase: () => string): JsonRequest {
  return async function request(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const base = getBase().replace(/\/$/, "");
    const url = path.startsWith("http") ? path : base + path;
    const { headers: optHeaders, ...rest } = init;
    const response = await fetch(url, {
      credentials: "include",
      ...rest,
      headers: { "content-type": "application/json", ...(optHeaders as Record<string, string> | undefined) },
    });
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(typeof body.error === "string" ? body.error : "Request failed");
    }
    return body;
  };
}

export function normalizeServerUrl(raw: string): string {
  let s = raw.trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  return s.replace(/\/$/, "");
}

/**
 * 当前页为 https 且主机不是本机（例如第三方托管的静态页）。
 * 此类页面无法向 `http://127.0.0.1` 发请求（混合内容），与 CORS 无关。
 */
export function isRemoteHttpsPage(): boolean {
  if (typeof window === "undefined") return false;
  if (window.location.protocol !== "https:") return false;
  const h = window.location.hostname;
  return h !== "localhost" && h !== "127.0.0.1";
}

/** 是否为指向本机环回的 HTTP API（浏览器在 https 页面上会拦截） */
export function isLoopbackHttpApi(url: string): boolean {
  const n = normalizeServerUrl(url);
  if (!n) return false;
  try {
    const u = new URL(n);
    if (u.protocol !== "http:") return false;
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}
