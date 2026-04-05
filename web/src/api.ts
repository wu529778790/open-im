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
