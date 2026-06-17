/**
 * ClawBot Client - WeChat iLink Bot API long-polling client
 *
 * Uses the official iLink protocol: POST + JSON body + Bearer token auth.
 * Receives messages via long-polling ilink/bot/getupdates and dispatches
 * them to the event handler.
 *
 * Reference: @tencent-weixin/openclaw-weixin, cc-wechat, claude-code-wechat-channel
 */

import { randomBytes } from 'node:crypto';
import { createLogger } from '../logger.js';
import { jitteredDelay, isFatalReconnectError, SLOW_PROBE_MS } from '../shared/reconnect.js';
import { cacheContextToken } from './message-sender.js';
import type { Config } from '../config.js';
import type {
  ClawBotState,
  ILinkMessage,
} from './types.js';
import { MessageItemType } from './types.js';
import { CLAWBOT_POLL_INTERVAL_MS } from '../constants.js';

const log = createLogger('ClawBot');

const RECONNECT_DELAYS_MS = [3000, 5000, 10000, 20000, 30000];
const BASE_INFO = { channel_version: '0.1.0' };

let pollController: AbortController | null = null;
let channelState: ClawBotState = 'disconnected';
let messageHandler: ((chatId: string, msgId: string, content: string) => Promise<void>) | null = null;
let stateChangeHandler: ((state: ClawBotState) => void) | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let fatal = false;
let stopped = false;
let apiUrl = 'https://ilinkai.weixin.qq.com';
let apiToken = '';
/** Opaque cursor for getupdates pagination (replaces numeric offset) */
let getUpdatesBuf = '';

export function getChannelState(): ClawBotState {
  return channelState;
}

export async function initClawbot(
  config: Config,
  eventHandler: (chatId: string, msgId: string, content: string) => Promise<void>,
  onStateChange?: (state: ClawBotState) => void,
): Promise<void> {
  const pc = config.platforms?.clawbot;
  if (!pc?.enabled) {
    throw new Error('ClawBot platform not enabled');
  }
  if (!pc.apiToken) {
    throw new Error('ClawBot apiToken required');
  }

  apiUrl = pc.apiUrl ?? 'https://ilinkai.weixin.qq.com';
  apiToken = pc.apiToken;
  messageHandler = eventHandler;
  stateChangeHandler = onStateChange ?? null;
  stopped = false;
  reconnectAttempt = 0;
  fatal = false;
  getUpdatesBuf = '';

  // Verify connectivity — non-fatal, reconnect loop will retry
  try {
    const res = await postApi('/ilink/bot/getupdates', {
      get_updates_buf: '',
      base_info: BASE_INFO,
    });
    if (!res.ok) {
      throw new Error(`API check failed: ${res.error ?? 'unknown'}`);
    }
    log.info(`ClawBot API reachable at ${apiUrl}`);
    fatal = false;
    reconnectAttempt = 0;
    if (res.updatesBuf) getUpdatesBuf = res.updatesBuf;
    updateState('connected');
    startPolling();
  } catch (err) {
    if (isFatalReconnectError(err)) {
      fatal = true;
      log.warn('ClawBot API auth/session error, will slow-probe:', err);
    } else {
      log.warn('ClawBot API not reachable, will retry:', err);
    }
    updateState('connecting');
    scheduleReconnect();
  }
  log.info('ClawBot client initialized');
}

function startPolling(): void {
  if (stopped || pollController) return;

  pollController = new AbortController();
  const signal = pollController.signal;

  (async () => {
    log.info('ClawBot long-polling started');
    while (!stopped && !signal.aborted) {
      try {
        const res = await postApi('/ilink/bot/getupdates', {
          get_updates_buf: getUpdatesBuf,
          base_info: BASE_INFO,
        }, signal);

        if (signal.aborted) break;

        if (!res.ok) {
          // Detect fatal errors (e.g. errcode -14 "session timeout") — retrying won't help
          if (res.errcode === -14 || isFatalReconnectError(res.error)) {
            log.warn(`ClawBot fatal error (errcode=${res.errcode}), entering slow-probe mode`);
            fatal = true;
            getUpdatesBuf = '';   // session expired, cursor is stale
            updateState('error');
            scheduleReconnect();
            return;
          }
          log.warn(`ClawBot getupdates error: ${res.error ?? 'unknown'}`);
          await sleep(CLAWBOT_POLL_INTERVAL_MS, signal);
          continue;
        }

        // Successful response — clear fatal mode and reset backoff
        if (fatal || reconnectAttempt > 0) {
          log.info('ClawBot connection recovered');
          fatal = false;
          reconnectAttempt = 0;
        }

        // Update cursor for next poll
        if (res.updatesBuf) {
          getUpdatesBuf = res.updatesBuf;
        }

        // Process messages
        const messages = res.messages ?? [];
        for (const msg of messages) {
          if (signal.aborted) break;
          if (msg.message_type !== 1) continue; // skip BOT messages, only process USER

          const extracted = extractTextContent(msg);
          if (!extracted) continue;

          const chatId = msg.from_user_id ?? '';
          const msgId = String(msg.message_id ?? msg.seq ?? '');
          const content = extracted;

          if (!chatId) {
            log.warn('ClawBot message missing from_user_id, skipping');
            continue;
          }

          // Cache context_token for reply capability
          if (msg.context_token) {
            cacheContextToken(chatId, msg.context_token);
          }

          log.info(`ClawBot message: chatId=${chatId}, msgId=${msgId}, content="${content.substring(0, 100)}"`);

          if (messageHandler) {
            try {
              await messageHandler(chatId, msgId, content);
            } catch (err) {
              log.error('Error in ClawBot message handler:', err);
            }
          }
        }
      } catch (err) {
        if (signal.aborted) break;
        if (err instanceof Error && err.name === 'AbortError') break;

        log.error('ClawBot polling error:', err);
        updateState('error');
        scheduleReconnect();
        return;
      }
    }
  })();
}

function scheduleReconnect(): void {
  if (stopped) return;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

  const baseDelay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
  const delay = fatal ? jitteredDelay(SLOW_PROBE_MS) : jitteredDelay(baseDelay);
  reconnectAttempt++;
  if (fatal) {
    log.warn(`ClawBot fatal error, slow-probe in ${Math.round(delay / 1000)}s (attempt ${reconnectAttempt})...`);
  } else {
    log.info(`ClawBot reconnecting in ${delay}ms (attempt ${reconnectAttempt})...`);
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (stopped) return;
    updateState('connected');
    startPolling();
  }, delay);
}

function updateState(state: ClawBotState): void {
  channelState = state;
  stateChangeHandler?.(state);
  log.debug(`ClawBot state: ${state}`);
}

/**
 * Extract text content from an iLink message's item_list.
 * Returns the first text item found, or a placeholder for media types.
 */
function extractTextContent(msg: ILinkMessage): string | null {
  if (!msg.item_list?.length) return null;

  for (const item of msg.item_list) {
    switch (item.type) {
      case MessageItemType.TEXT: {
        if (!item.text_item?.text) continue;
        let text = item.text_item.text;
        if (item.ref_msg?.title) {
          text = `[引用: ${item.ref_msg.title}]\n${text}`;
        }
        return text;
      }
      case MessageItemType.VOICE: {
        const transcript = item.voice_item?.text;
        if (transcript) return `[语音转文字] ${transcript}`;
        return '[语音消息（无文字转录）]';
      }
      case MessageItemType.IMAGE:
        return '[图片]';
      case MessageItemType.FILE: {
        const name = item.file_item?.file_name ? ` "${item.file_item.file_name}"` : '';
        return `[文件${name}]`;
      }
      case MessageItemType.VIDEO:
        return '[视频]';
      default:
        return `[未知消息类型 ${item.type}]`;
    }
  }
  return null;
}

/**
 * POST to iLink API with JSON body and Bearer token auth.
 */
async function postApi(
  endpoint: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ ok: boolean; error?: string; errcode?: number; updatesBuf?: string; messages?: ILinkMessage[] }> {
  const url = `${apiUrl}${endpoint}`;
  const bodyStr = JSON.stringify(body);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'AuthorizationType': 'ilink_bot_token',
    'X-WECHAT-UIN': randomBytes(4).readUInt32BE(0).toString(10),
    'Authorization': `Bearer ${apiToken}`,
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: bodyStr,
      signal,
    });
    const text = await res.text();
    const raw = JSON.parse(text) as Record<string, unknown>;

    // iLink API: { ret: 0 } for success, { errcode: -14 } for session timeout, etc.
    const ret = typeof raw.ret === 'number' ? raw.ret : undefined;
    const errcode = typeof raw.errcode === 'number' ? raw.errcode : undefined;
    const ok = ret === 0 || ret === undefined;
    const error = ok ? undefined : String(raw.errmsg ?? raw.msg ?? `ret=${ret}`);

    if (!ok) {
      log.warn(`ClawBot API ${endpoint} response: ${text.substring(0, 500)}`);
    }

    return {
      ok,
      error,
      errcode,
      updatesBuf: typeof raw.get_updates_buf === 'string' ? raw.get_updates_buf : undefined,
      messages: Array.isArray(raw.msgs) ? raw.msgs as ILinkMessage[] : undefined,
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw err;
    }
    log.warn(`ClawBot API ${endpoint} error:`, err);
    throw err;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(); return; }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

export function stopClawbot(): void {
  log.info('Stopping ClawBot client...');
  stopped = true;
  if (pollController) { pollController.abort(); pollController = null; }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  messageHandler = null;
  updateState('disconnected');
  log.info('ClawBot client stopped');
}
