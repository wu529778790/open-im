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
import { setClawbotContextToken, clearClawbotContextToken } from '../shared/active-chats.js';
import { downloadMediaFromUrl, createMediaTargetPath } from '../shared/media-storage.js';
import { createDecipheriv } from 'node:crypto';
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
let messageHandler: ((chatId: string, msgId: string, content: string, imagePaths?: string[]) => Promise<void>) | null = null;
let stateChangeHandler: ((state: ClawBotState) => void) | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let reconnectAttempt = 0;
let fatal = false;
let stopped = false;
let apiUrl = 'https://ilinkai.weixin.qq.com';
let apiToken = '';
/** Opaque cursor for getupdates pagination (replaces numeric offset) */
let getUpdatesBuf = '';
/** Timestamp of last successful poll response (for watchdog) */
let lastResponseAt = 0;
/** Per-request timeout for long-polling (ms) */
const POLL_REQUEST_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes
/** Watchdog interval: force reconnect if no response for this long (ms) */
const WATCHDOG_INTERVAL_MS = 60_000; // check every 60s
const WATCHDOG_STALE_MS = 5 * 60 * 1000; // 5 minutes without response = stale

export function getChannelState(): ClawBotState {
  return channelState;
}

export async function initClawbot(
  config: Config,
  eventHandler: (chatId: string, msgId: string, content: string, imagePaths?: string[]) => Promise<void>,
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

  // Start polling directly — no blocking connectivity check.
  // The polling loop handles errors and reconnection internally.
  updateState('connected');
  startPolling();
  log.info('ClawBot client initialized');
}

function startPolling(): void {
  if (stopped || pollController) return;

  pollController = new AbortController();
  const signal = pollController.signal;

  // Start watchdog to detect stale connections (e.g. Mac sleep / network drop)
  startWatchdog();

  (async () => {
    log.info('ClawBot long-polling started');
    while (!stopped && !signal.aborted) {
      try {
        // Combine the poll controller signal with a per-request timeout
        const timeoutSignal = AbortSignal.timeout(POLL_REQUEST_TIMEOUT_MS);
        const combinedSignal = AbortSignal.any([signal, timeoutSignal]);
        const res = await postApi('/ilink/bot/getupdates', {
          get_updates_buf: getUpdatesBuf,
          base_info: BASE_INFO,
        }, combinedSignal);

        // Record successful response time for watchdog
        lastResponseAt = Date.now();

        if (signal.aborted) break;

        if (!res.ok) {
          // Detect fatal errors (e.g. errcode -14 "session timeout") — retrying won't help
          if (res.errcode === -14 || isFatalReconnectError(res.error)) {
            log.warn(`ClawBot fatal error (errcode=${res.errcode}), entering slow-probe mode`);
            fatal = true;
            getUpdatesBuf = '';   // session expired, cursor is stale
            clearClawbotContextToken(); // session expired, token is stale
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

        // Step 1: Extract valid USER messages and cache context tokens
        const userMessages: { chatId: string; msgId: string; content: string; imagePaths?: string[] }[] = [];
        for (const msg of messages) {
          if (signal.aborted) break;
          if (msg.message_type !== 1) continue; // skip BOT messages, only process USER

          const extracted = extractTextContent(msg);
          if (!extracted) continue;

          const chatId = msg.from_user_id ?? '';
          const msgId = String(msg.message_id ?? msg.seq ?? '');

          if (!chatId) {
            log.warn('ClawBot message missing from_user_id, skipping');
            continue;
          }

          // Cache context_token for reply capability (in-memory + persisted)
          if (msg.context_token) {
            cacheContextToken(chatId, msg.context_token);
            setClawbotContextToken(msg.context_token);
          }

          // Debug: log raw item_list for image messages
          if (extracted === '[图片]') {
            log.info(`Image message raw item_list: ${JSON.stringify(msg.item_list).substring(0, 2000)}`);
          }

          // Extract and download images from message
          const imagePaths = await extractImages(msg);          userMessages.push({ chatId, msgId, content: extracted, imagePaths: imagePaths.length > 0 ? imagePaths : undefined });
        }

        // Step 2: Aggregate consecutive messages from the same user
        // ClawBot splits image+text into separate messages; combine them
        const aggregated: { chatId: string; msgId: string; content: string; imagePaths?: string[] }[] = [];
        for (const m of userMessages) {
          const last = aggregated[aggregated.length - 1];
          if (last && last.chatId === m.chatId) {
            // Same user — merge content and image paths
            last.content = `${last.content}\n${m.content}`;
            if (m.imagePaths?.length) {
              last.imagePaths = [...(last.imagePaths ?? []), ...m.imagePaths];
            }
          } else {
            aggregated.push({ chatId: m.chatId, msgId: m.msgId, content: m.content, imagePaths: m.imagePaths });
          }
        }

        // Step 3: Dispatch aggregated messages
        for (const m of aggregated) {
          if (signal.aborted) break;
          log.info(`ClawBot message: chatId=${m.chatId}, msgId=${m.msgId}, content="${m.content.substring(0, 100)}", images=${m.imagePaths?.length ?? 0}`);

          if (messageHandler) {
            try {
              await messageHandler(m.chatId, m.msgId, m.content, m.imagePaths);
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
 * Watchdog: periodically check if the poll loop is alive.
 * After Mac sleep or network drop, the fetch may hang without throwing.
 * If no successful response for WATCHDOG_STALE_MS, force a reconnect.
 */
function startWatchdog(): void {
  stopWatchdog();
  lastResponseAt = Date.now();
  watchdogTimer = setInterval(() => {
    if (stopped) return;
    const elapsed = Date.now() - lastResponseAt;
    if (elapsed > WATCHDOG_STALE_MS) {
      log.warn(`ClawBot watchdog: no response for ${Math.round(elapsed / 1000)}s, forcing reconnect`);
      if (pollController) { pollController.abort(); pollController = null; }
      updateState('error');
      scheduleReconnect();
    }
  }, WATCHDOG_INTERVAL_MS);
}

function stopWatchdog(): void {
  if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
}

/**
 * Extract and download images from a ClawBot message's item_list.
 * Images are encrypted with AES and hosted on CDN.
 */
async function extractImages(msg: ILinkMessage): Promise<string[]> {
  if (!msg.item_list?.length) return [];

  const paths: string[] = [];
  for (const item of msg.item_list) {
    if (item.type !== MessageItemType.IMAGE) continue;

    const imageItem = item.image_item;
    const media = imageItem?.media;
    // iLink API 使用 full_url 而非 cdn_url
    const imageUrl = media?.full_url || media?.cdn_url;
    if (!imageUrl) {
      log.warn('Image item missing full_url/cdn_url');
      continue;
    }

    try {
      // 直接从 full_url 下载图片（CDN 返回的是已解密的图片数据）
      const response = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) { log.warn(`Image download failed: HTTP ${response.status}`); continue; }
      const buffer = Buffer.from(await response.arrayBuffer());

      // 检查是否是有效图片
      const first4 = buffer.subarray(0, 4).toString('hex');
      const isJpeg = first4 === 'ffd8ffe0' || first4 === 'ffd8ffe1';
      const isPng = first4 === '89504e47';

      let finalBuffer: Buffer;
      if (isJpeg || isPng) {
        // CDN 返回的是有效图片，直接使用
        finalBuffer = buffer;
      } else {
        // CDN 返回的是加密数据，尝试解密
        const aesKeyHex = imageItem?.aeskey;
        if (aesKeyHex && aesKeyHex.length === 32) {
          try {
            // AES-128-ECB 模式（官方 SDK 实现，无需 IV）
            const keyBuf = Buffer.from(aesKeyHex, 'hex');
            const decipher = createDecipheriv('aes-128-ecb', keyBuf, null);
            finalBuffer = Buffer.concat([decipher.update(buffer), decipher.final()]);
          } catch {
            log.info('AES-128-ECB decryption failed, using raw image data');
            finalBuffer = buffer;
          }
        } else {
          finalBuffer = buffer;
        }
      }

      // Save to disk
      const targetPath = createMediaTargetPath('.jpg', `clawbot-${Date.now()}`);
      const { writeFile } = await import('node:fs/promises');
      const { mkdir } = await import('node:fs/promises');
      await mkdir('/tmp/t/open-im-images', { recursive: true });
      await writeFile(targetPath, finalBuffer);
      paths.push(targetPath);
      log.info(`ClawBot image saved: ${targetPath}`);
    } catch (err) {
      log.warn('Failed to process ClawBot image:', err);
    }
  }
  return paths;
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
  stopWatchdog();
  messageHandler = null;
  // Don't clear context_token here — it's persisted for startup notifications
  updateState('disconnected');
  log.info('ClawBot client stopped');
}
