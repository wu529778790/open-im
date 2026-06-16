/**
 * ClawBot Client - WeChat iLink API long-polling client
 *
 * Receives messages via long-polling ilink/bot/getupdates
 * and dispatches them to the event handler.
 */

import { createLogger } from '../logger.js';
import { jitteredDelay, SLOW_PROBE_MS } from '../shared/reconnect.js';
import type { Config } from '../config.js';
import type { ClawBotState, ClawBotUpdate, ClawBotUpdatesResponse } from './types.js';
import { CLAWBOT_POLL_INTERVAL_MS } from '../constants.js';

const log = createLogger('ClawBot');

const RECONNECT_DELAYS_MS = [3000, 5000, 10000, 20000, 30000];

let pollController: AbortController | null = null;
let channelState: ClawBotState = 'disconnected';
let messageHandler: ((chatId: string, msgId: string, content: string) => Promise<void>) | null = null;
let stateChangeHandler: ((state: ClawBotState) => void) | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let stopped = false;
let apiUrl = 'http://127.0.0.1:26322';
let apiToken = '';
let lastUpdateId = 0;

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

  apiUrl = pc.apiUrl ?? 'http://127.0.0.1:26322';
  apiToken = pc.apiToken;
  messageHandler = eventHandler;
  stateChangeHandler = onStateChange ?? null;
  stopped = false;
  reconnectAttempt = 0;
  lastUpdateId = 0;

  // Verify connectivity — non-fatal, reconnect loop will retry
  try {
    const res = await fetchApi('/ilink/bot/getupdates?timeout=1');
    if (!res.ok) {
      throw new Error(`API check failed: ${res.error ?? 'unknown'}`);
    }
    log.info(`ClawBot API reachable at ${apiUrl}`);
    updateState('connected');
    startPolling();
  } catch (err) {
    log.warn('ClawBot API not reachable, will retry:', err);
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
        const url = `/ilink/bot/getupdates?timeout=30${lastUpdateId > 0 ? `&offset=${lastUpdateId + 1}` : ''}`;
        const res = await fetchApi(url, signal);

        if (signal.aborted) break;

        if (!res.ok) {
          log.warn(`ClawBot getupdates error: ${res.error ?? 'unknown'}`);
          await sleep(CLAWBOT_POLL_INTERVAL_MS, signal);
          continue;
        }

        const updates = (res as ClawBotUpdatesResponse).result ?? [];
        for (const update of updates) {
          if (signal.aborted) break;
          lastUpdateId = Math.max(lastUpdateId, update.update_id);

          const msg = update.message;
          if (!msg?.text) continue;

          const chatId = msg.chat?.id ?? msg.from?.id ?? '';
          const msgId = String(msg.message_id ?? update.update_id);
          const content = msg.text;

          if (!chatId) {
            log.warn('ClawBot message missing chatId, skipping');
            continue;
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
  const delay = jitteredDelay(baseDelay);
  reconnectAttempt++;
  log.info(`ClawBot reconnecting in ${delay}ms (attempt ${reconnectAttempt})...`);

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

async function fetchApi(
  path: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; error?: string; result?: unknown }> {
  const url = `${apiUrl}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiToken}` },
    signal,
  });
  return res.json() as Promise<{ ok: boolean; error?: string; result?: unknown }>;
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
