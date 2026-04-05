import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { OutgoingHttpHeaders } from "node:http";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

/** npm 包内 `web/dist`（与 dist/*.js 相对路径固定） */
export function getWebDistDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidate = join(here, "..", "web", "dist");
  if (existsSync(join(candidate, "index.html"))) return candidate;
  return null;
}

function resolveUnderRoot(root: string, pathname: string): string | null {
  const rel =
    pathname === "/" || pathname === "/index.html" ? "index.html" : pathname.startsWith("/") ? pathname.slice(1) : pathname;
  if (!rel || rel.includes("..")) return null;
  const abs = resolve(join(root, rel));
  const rootR = resolve(root);
  const relPath = relative(rootR, abs);
  if (relPath.startsWith("..") || relPath.startsWith("/")) return null;
  if (!existsSync(abs) || !statSync(abs).isFile()) return null;
  return abs;
}

/**
 * 若存在内置 `web/dist`，则对 GET 返回对应静态文件（含 `/` → index.html）。
 * @returns 是否已响应
 */
export function tryServeDashboardStatic(
  requestUrl: URL,
  request: IncomingMessage,
  response: ServerResponse,
  mergeCors: (r: IncomingMessage, h: OutgoingHttpHeaders) => OutgoingHttpHeaders,
): boolean {
  if (request.method !== "GET") return false;
  const root = getWebDistDir();
  if (!root) return false;

  const filePath = resolveUnderRoot(root, requestUrl.pathname);
  if (!filePath) return false;

  const ext = extname(filePath).toLowerCase();
  const ct = MIME[ext] ?? "application/octet-stream";
  const body = readFileSync(filePath);
  const cacheCtl = requestUrl.pathname.startsWith("/assets/") ? "max-age=3600" : "no-cache";
  response.writeHead(200, mergeCors(request, { "content-type": ct, "cache-control": cacheCtl }));
  response.end(body);
  return true;
}
