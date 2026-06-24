import type { IncomingMessage } from "node:http";
import { randomBytes } from "node:crypto";
import { parse, serialize } from "cookie";

export interface LoginTokenInfo {
  expiresAt: number;
}

interface SessionInfo {
  expiresAt: number;
  remoteAddr?: string;
  userAgent?: string;
}

const pendingLogins = new Map<string, LoginTokenInfo>();
const activeSessions = new Map<string, SessionInfo>();

export function getWebConfigHost(): string {
  const envHost = process.env.OPEN_IM_WEB_HOST?.trim();
  if (envHost) return envHost;
  return "127.0.0.1";
}

/** 设为 true 时，非本机绑定的 Web 配置服务跳过登录 Cookie 校验（仅适用于受信网络；生产建议配合 HTTPS 反向代理） */
export function allowRemoteApiWithoutAuth(): boolean {
  return process.env.OPEN_IM_ALLOW_REMOTE_API === "true";
}

function generateRandomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function cleanupExpiredAuth(now: number): void {
  for (const [token, info] of pendingLogins) {
    if (info.expiresAt <= now) pendingLogins.delete(token);
  }
  for (const [sessionId, info] of activeSessions) {
    if (info.expiresAt <= now) activeSessions.delete(sessionId);
  }
}

export function consumeLoginToken(loginToken: string): LoginTokenInfo | undefined {
  const info = pendingLogins.get(loginToken);
  if (!info) return undefined;
  pendingLogins.delete(loginToken);
  const now = Date.now();
  if (info.expiresAt <= now) return undefined;
  return info;
}

export function createLoginToken(ttlMs: number): string {
  const now = Date.now();
  cleanupExpiredAuth(now);
  const token = generateRandomToken(32);
  pendingLogins.set(token, { expiresAt: now + ttlMs });
  return token;
}

export function createSession(request: IncomingMessage, ttlMs: number): string {
  const now = Date.now();
  cleanupExpiredAuth(now);
  const sessionId = generateRandomToken(32);
  const remoteAddr = (request.socket as { remoteAddress?: string }).remoteAddress;
  const userAgent = typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : undefined;
  activeSessions.set(sessionId, {
    expiresAt: now + ttlMs,
    remoteAddr,
    userAgent,
  });
  return sessionId;
}

function parseCookies(request: IncomingMessage): Record<string, string> {
  const header = request.headers.cookie;
  if (!header) return {};
  // 使用成熟的 cookie 库，更安全可靠
  const cookies = parse(header);
  // 转换为 Record<string, string>，过滤掉 undefined 值
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(cookies)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function getSessionIdFromRequest(request: IncomingMessage): string | null {
  const cookies = parseCookies(request);
  const sessionId = cookies.openim_session;
  return sessionId && typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
}

export function isSessionValid(request: IncomingMessage): boolean {
  const sessionId = getSessionIdFromRequest(request);
  if (!sessionId) return false;
  const info = activeSessions.get(sessionId);
  if (!info) return false;
  const now = Date.now();
  if (info.expiresAt <= now) {
    activeSessions.delete(sessionId);
    return false;
  }
  // Optional: tie session to basic client fingerprint (remote address)
  const remoteAddr = (request.socket as { remoteAddress?: string }).remoteAddress;
  if (info.remoteAddr && remoteAddr && remoteAddr !== info.remoteAddr) {
    return false;
  }
  return true;
}

export function buildSessionCookie(sessionId: string, ttlMs: number, isHttps = false): string {
  const maxAgeSec = Math.floor(ttlMs / 1000);
  const options: Parameters<typeof serialize>[2] = {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: maxAgeSec,
  };
  
  // 根据请求协议动态设置 Secure 标志
  // 在生产环境（HTTPS 反代后）应该设置为 true
  if (isHttps || process.env.NODE_ENV === "production") {
    options.secure = true;
  }
  
  // 使用成熟的 cookie 库的 serialize 函数
  return serialize("openim_session", sessionId, options);
}

export function generateLoginUrl(host: string, port: number, loginTtlMs: number): string {
  const loginToken = createLoginToken(loginTtlMs);
  const displayHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  const baseUrl = `http://${displayHost}:${port}`;
  return `${baseUrl}/?login_token=${encodeURIComponent(loginToken)}`;
}
