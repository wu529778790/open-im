/**
 * ClawBot Message Sender - Send messages via iLink Bot API
 *
 * Uses POST + JSON body + Bearer token auth (iLink protocol).
 */

import { randomBytes } from 'node:crypto';
import { createLogger } from '../logger.js';
import { splitLongContent, toReplyPlainText } from '../shared/utils.js';
import { MAX_CLAWBOT_MESSAGE_LENGTH } from '../constants.js';
import { getChannelState } from './client.js';
import type { SendMessageResponse } from './types.js';

const log = createLogger('ClawBotSender');

let apiUrl = 'https://ilinkai.weixin.qq.com';
let apiToken = '';

/** Cache of context_token per chatId, populated by incoming messages */
const contextTokenCache = new Map<string, string>();

export function initClawBotSender(url: string, token: string): void {
  apiUrl = url;
  apiToken = token;
}

/** Cache a context_token for a chatId (called when receiving messages) */
export function cacheContextToken(chatId: string, token: string): void {
  contextTokenCache.set(chatId, token);
}

/** Get cached context_token for a chatId */
export function getCachedContextToken(chatId: string): string | undefined {
  return contextTokenCache.get(chatId);
}

/** Build iLink API request headers */
function buildHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'AuthorizationType': 'ilink_bot_token',
    'X-WECHAT-UIN': randomBytes(4).readUInt32BE(0).toString(10),
    'Authorization': `Bearer ${apiToken}`,
  };
}

/** Generate a unique client_id for outbound messages */
function generateClientId(): string {
  return `open-im:${Date.now()}-${randomBytes(4).toString('hex')}`;
}

async function postMessage(chatId: string, text: string, contextToken?: string): Promise<boolean> {
  if (getChannelState() !== 'connected') {
    log.warn('ClawBot not connected, cannot send message');
    return false;
  }

  const token = contextToken ?? getCachedContextToken(chatId);
  if (!token) {
    log.warn(`ClawBot no context_token for chatId=${chatId}, cannot send reply`);
    return false;
  }

  try {
    const url = `${apiUrl}/ilink/bot/sendmessage`;
    const body = JSON.stringify({
      msg: {
        from_user_id: '',
        to_user_id: chatId,
        client_id: generateClientId(),
        message_type: 2,     // BOT
        message_state: 2,    // FINISH
        item_list: [{ type: 1, text_item: { text } }],
        context_token: token,
      },
      base_info: { channel_version: '0.1.0' },
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(),
      body,
    });

    const data = await res.json() as SendMessageResponse;
    const ok = data.ret === 0 || data.ret === undefined;
    if (!ok) {
      log.error(`ClawBot sendmessage failed: ret=${data.ret} errcode=${data.errcode} errmsg=${data.errmsg}`);
      return false;
    }
    return true;
  } catch (err) {
    log.error('ClawBot sendmessage error:', err);
    return false;
  }
}

/**
 * Send text reply to a ClawBot chat, splitting long messages automatically.
 */
export async function sendTextReply(chatId: string, text: string, contextToken?: string): Promise<void> {
  const plainText = toReplyPlainText(text);
  const parts = splitLongContent(plainText, MAX_CLAWBOT_MESSAGE_LENGTH);

  if (parts.length === 1) {
    log.info(`Sending ClawBot reply to chatId=${chatId}, len=${plainText.length}`);
    await postMessage(chatId, plainText, contextToken);
    return;
  }

  log.info(`Sending ClawBot reply in ${parts.length} parts to chatId=${chatId}, totalLen=${plainText.length}`);
  for (let i = 0; i < parts.length; i++) {
    const partText = i === 0
      ? `${parts[i]}\n\n_(1/${parts.length})_`
      : `_(续 ${i + 1}/${parts.length})_\n\n${parts[i]}`;
    await postMessage(chatId, partText, contextToken);
    log.info(`ClawBot part ${i + 1}/${parts.length} sent`);
  }
}

/**
 * Send error reply to a ClawBot chat.
 */
export async function sendErrorReply(chatId: string, error: string): Promise<void> {
  log.warn(`Sending ClawBot error to chatId=${chatId}`);
  await postMessage(chatId, `错误: ${error}`);
}
