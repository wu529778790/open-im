import type { IncomingMessage, OutgoingHttpHeaders } from "node:http";
import { URL } from "node:url";
import { getPublicWebDashboardUrl } from "./constants.js";

export function splitCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

/** 是否允许该浏览器 Origin（与 getPublicWebDashboardUrl() 同源时始终允许，便于反代 / 自定义 OPEN_IM_PUBLIC_WEB_URL） */
function isCorsOriginAllowed(origin: string): boolean {
  const publicWeb = getPublicWebDashboardUrl();
  try {
    if (origin === new URL(publicWeb).origin) return true;
  } catch {
    if (origin === publicWeb) return true;
  }

  const allowlist = splitCsv(process.env.OPEN_IM_CORS_ORIGINS);
  if (allowlist.length === 0) return true;
  return allowlist.includes(origin);
}

/** 有 Origin 时返回 CORS 响应头；无 Origin（如本地 file:// 或同源内置页）不返回，行为与原来一致 */
export function corsHeadersFor(request: IncomingMessage): Record<string, string> | undefined {
  const originRaw = request.headers.origin;
  if (!originRaw || typeof originRaw !== "string") return undefined;

  if (!isCorsOriginAllowed(originRaw)) return undefined;

  const requestedHeaders = request.headers["access-control-request-headers"];
  const allowHeaders =
    typeof requestedHeaders === "string" && requestedHeaders.trim()
      ? requestedHeaders
      : "Content-Type, Authorization";

  return {
    "Access-Control-Allow-Origin": originRaw,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": allowHeaders,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
  };
}

export function mergeCors(request: IncomingMessage, headers: OutgoingHttpHeaders): OutgoingHttpHeaders {
  const cors = corsHeadersFor(request);
  if (!cors) return headers;
  return { ...headers, ...cors };
}
