import WebSocket from "ws";
import type { Config } from "../config.js";
import { createLogger } from "../logger.js";
import { ReconnectManager, HeartbeatMonitor } from "../shared/connection-manager.js";
import type { QQAttachment, QQMessageEvent } from "./types.js";

const log = createLogger("QQ");

const TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";
const API_BASE = "https://api.sgroup.qq.com";
const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];
const INTENTS = {
  PUBLIC_GUILD_MESSAGES: 1 << 30,
  DIRECT_MESSAGE: 1 << 12,
  GROUP_AND_C2C: 1 << 25,
};

interface TokenState {
  token: string;
  expiresAt: number;
}

interface GatewayPayload {
  op: number;
  d?: unknown;
  s?: number | null;
  t?: string;
}

interface QQClient {
  sendPrivateMessage(openid: string, content: string, replyToMessageId?: string): Promise<string | undefined>;
  sendGroupMessage(groupOpenid: string, content: string, replyToMessageId?: string): Promise<string | undefined>;
  sendChannelMessage(channelId: string, content: string, replyToMessageId?: string): Promise<string | undefined>;
}

let client: QQClient | null = null;
let ws: WebSocket | null = null;
let stopped = false;
let seq: number | null = null;
let sessionId: string | null = null;
let connecting = false; // 防止并发 connectWebSocket
let currentConfig: Config | null = null;
let currentHandler: ((event: QQMessageEvent) => Promise<void>) | null = null;
let tokenState: TokenState | null = null;

// Connection infrastructure (shared managers replace raw timers/counters)
const heartbeatMonitor = new HeartbeatMonitor();
const reconnectManager = new ReconnectManager({
  name: 'QQ',
  backoff: { mode: 'stepped', delays: RECONNECT_DELAYS_MS },
  onReconnect: () => reconnectFn(),
});

async function reconnectFn(): Promise<void> {
  if (currentConfig && currentHandler) {
    await connectWebSocket(currentConfig, currentHandler);
  }
}

function buildAuthHeaders(token: string): Record<string, string> {
  return {
    Authorization: `QQBot ${token}`,
    "Content-Type": "application/json",
  };
}

async function fetchAccessToken(config: Config): Promise<string> {
  if (tokenState && Date.now() < tokenState.expiresAt - 5 * 60 * 1000) {
    return tokenState.token;
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      appId: config.qqAppId,
      clientSecret: config.qqSecret,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    message?: string;
  };

  if (!response.ok || !data.access_token) {
    throw new Error(data.message || `Failed to get QQ access token: HTTP ${response.status}`);
  }

  tokenState = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 7200) * 1000,
  };
  return data.access_token;
}

async function apiRequest<T>(
  config: Config,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = await fetchAccessToken(config);
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: buildAuthHeaders(token),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    if (response.status === 401) {
      tokenState = null;
    }
    throw new Error(`QQ API ${method} ${path} failed: HTTP ${response.status} ${text.slice(0, 200)}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

interface QQApiMessageResponse {
  id?: string;
}

function buildMessageBody(content: string, replyToMessageId?: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    content,
    msg_type: 0,
  };
  if (replyToMessageId) {
    body.msg_id = replyToMessageId;
    body.msg_seq = Math.floor(Math.random() * 65535);
  }
  return body;
}

async function getGatewayUrl(config: Config): Promise<string> {
  const data = await apiRequest<{ url: string }>(config, "GET", "/gateway");
  return data.url;
}

function normalizeInboundEvent(payload: GatewayPayload): QQMessageEvent | null {
  const type = payload.t;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (payload.d ?? {}) as Record<string, any>;
  const attachments = Array.isArray(data.attachments)
    ? data.attachments.map((attachment): QQAttachment => ({
        url: typeof attachment?.url === "string" ? attachment.url : undefined,
        filename: typeof attachment?.filename === "string" ? attachment.filename : undefined,
        contentType: typeof attachment?.content_type === "string" ? attachment.content_type : undefined,
        size: typeof attachment?.size === "number" ? attachment.size : undefined,
        width: typeof attachment?.width === "number" ? attachment.width : undefined,
        height: typeof attachment?.height === "number" ? attachment.height : undefined,
        raw: attachment as Record<string, unknown>,
      }))
    : undefined;
  const baseEvent = {
    id: String(data.id ?? ""),
    content: String(data.content ?? "").trim(),
    attachments,
    raw: data,
  };

  if (type === "C2C_MESSAGE_CREATE") {
    return {
      type: "private",
      ...baseEvent,
      userOpenid: String(data.author?.user_openid ?? ""),
    };
  }

  if (type === "GROUP_AT_MESSAGE_CREATE") {
    return {
      type: "group",
      ...baseEvent,
      userOpenid: String(data.author?.member_openid ?? ""),
      groupOpenid: String(data.group_openid ?? ""),
    };
  }

  if (type === "AT_MESSAGE_CREATE" || type === "DIRECT_MESSAGE_CREATE") {
    return {
      type: "channel",
      ...baseEvent,
      userOpenid: String(data.author?.id ?? ""),
      channelId: String(data.channel_id ?? ""),
    };
  }

  return null;
}

/**
 * Heartbeat tick: send ping and detect stale connections.
 * The heartbeat interval is dynamic (from QQ gateway HELLO message).
 */
let heartbeatIntervalMs = 30000;

function heartbeatTick(): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  if (heartbeatMonitor.isStale(heartbeatIntervalMs * 3)) {
    const elapsed = Date.now() - heartbeatMonitor.lastResponseTime;
    log.warn(`QQ dead connection: no response for ${Math.round(elapsed / 1000)}s, reconnecting`);
    heartbeatMonitor.stop();
    ws?.terminate();
    reconnectFn().catch((err) => log.error('QQ reconnect from heartbeat failed:', err));
    return;
  }

  try {
    ws.send(JSON.stringify({ op: 1, d: seq }));
  } catch (err) {
    log.warn('QQ heartbeat send failed:', err);
  }
}

async function connectWebSocket(config: Config, handler: (event: QQMessageEvent) => Promise<void>): Promise<void> {
  // 防止并发连接
  if (connecting) {
    log.warn("QQ gateway connection already in progress");
    return;
  }
  connecting = true;

  try {
    const gatewayUrl = await getGatewayUrl(config);
    const token = await fetchAccessToken(config);

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(gatewayUrl);
      ws = socket;
      let settled = false;
      let readyTimeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        readyTimeoutId = null;
        settle(() => reject(new Error("QQ gateway ready timeout")));
      }, 15000);

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        if (readyTimeoutId) {
          clearTimeout(readyTimeoutId);
          readyTimeoutId = null;
        }
        fn();
      };

      socket.on("open", () => {
        log.info("QQ gateway connected");
        reconnectManager.reset();
      });

      socket.on("message", async (raw) => {
        heartbeatMonitor.recordResponse();
        try {
          const payload = JSON.parse(raw.toString()) as GatewayPayload;
          if (typeof payload.s === "number") seq = payload.s;

          if (payload.op === 10) {
            heartbeatIntervalMs = Number((payload.d as { heartbeat_interval?: number })?.heartbeat_interval ?? 30000);
            heartbeatMonitor.start(heartbeatIntervalMs, heartbeatTick);
            socket.send(
              JSON.stringify({
                op: sessionId ? 6 : 2,
                d: sessionId
                  ? {
                      token: `QQBot ${token}`,
                      session_id: sessionId,
                      seq,
                    }
                  : {
                      token: `QQBot ${token}`,
                      intents:
                        INTENTS.GROUP_AND_C2C |
                        INTENTS.DIRECT_MESSAGE |
                        INTENTS.PUBLIC_GUILD_MESSAGES,
                      properties: {
                        os: process.platform,
                        browser: "open-im",
                        device: "open-im",
                      },
                    },
              }),
            );
            return;
          }

          if (payload.op === 0 && payload.t === "READY") {
            sessionId = String((payload.d as { session_id?: string })?.session_id ?? "");
            settle(resolve);
            return;
          }

          if (payload.op === 0 && payload.t === "RESUMED") {
            settle(resolve);
            return;
          }

          const event = normalizeInboundEvent(payload);
          if (event && (event.content || (event.attachments?.length ?? 0) > 0)) {
            await handler(event);
          }
        } catch (error) {
          log.error("Failed to handle QQ gateway payload:", error);
        }
      });

      socket.on("error", (error) => {
        log.error("QQ gateway error:", error);
        settle(() => reject(error));
      });

      socket.on("close", (code, reason) => {
        settle(() => {}); // 清理 ready timeout
        heartbeatMonitor.stop();
        ws = null;
        const reasonStr = reason.toString();
        if (code === 4009) {
          log.info(`QQ gateway session idle timeout (4009), reconnecting… (${reasonStr})`);
        } else {
          log.info(`QQ gateway closed: ${code} ${reasonStr}`);
        }
        if (stopped) return;
        // 4009 仅为长连接会话过期，HTTP access_token 仍有效，勿清空 tokenState
        if (code === 4004 || code === 4006 || code === 4007) {
          tokenState = null;
        }
        if (code === 4004 || code === 4006 || code === 4007 || code === 4009) {
          sessionId = null;
          seq = null;
        }
        const isFatalClose = code === 4004 || code === 4006 || code === 4007;
        if (isFatalClose) {
          reconnectManager.setFatal(true);
          log.warn(`QQ 致命关闭码 ${code}（鉴权失败），转慢探测（每 ${Math.round(5 * 60)}s 一次）`);
        }
        reconnectManager.schedule();
      });
    });
  } finally {
    connecting = false;
  }
}

export function getQQBot(): QQClient {
  if (!client || !currentConfig) {
    throw new Error("QQ bot is not initialized");
  }
  return client;
}

export async function initQQ(
  config: Config,
  eventHandler: (event: QQMessageEvent) => Promise<void>,
): Promise<void> {
  if (!config.qqAppId || !config.qqSecret) {
    throw new Error("QQ Bot App ID and Secret are required");
  }

  stopped = false;
  currentConfig = config;
  currentHandler = eventHandler;
  reconnectManager.reset();
  reconnectManager.resume();
  client = {
    sendPrivateMessage: async (openid, content, replyToMessageId) => {
      const res = await apiRequest<QQApiMessageResponse>(
        config,
        "POST",
        `/v2/users/${openid}/messages`,
        buildMessageBody(content, replyToMessageId),
      );
      return res.id;
    },
    sendGroupMessage: async (groupOpenid, content, replyToMessageId) => {
      const res = await apiRequest<QQApiMessageResponse>(
        config,
        "POST",
        `/v2/groups/${groupOpenid}/messages`,
        buildMessageBody(content, replyToMessageId),
      );
      return res.id;
    },
    sendChannelMessage: async (channelId, content, replyToMessageId) => {
      const res = await apiRequest<QQApiMessageResponse>(config, "POST", `/channels/${channelId}/messages`, {
        content,
        ...(replyToMessageId ? { msg_id: replyToMessageId } : {}),
      });
      return res.id;
    },
  };

  await connectWebSocket(config, eventHandler);
  log.info("QQ bot initialized");
}

export async function stopQQ(): Promise<void> {
  stopped = true;
  heartbeatMonitor.stop();
  reconnectManager.stop();
  if (ws) {
    ws.close(1000);
    ws = null;
  }
  client = null;
  currentConfig = null;
  currentHandler = null;
  tokenState = null;
  sessionId = null;
  seq = null;
}
