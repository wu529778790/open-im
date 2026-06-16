/**
 * ClawBot Message Sender - Send messages via iLink API
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '../logger.js';
import { splitLongContent, toReplyPlainText } from '../shared/utils.js';
import { MAX_CLAWBOT_MESSAGE_LENGTH } from '../constants.js';
import { getChannelState } from './client.js';

const log = createLogger('ClawBotSender');

let apiUrl = 'http://127.0.0.1:26322';
let apiToken = '';

export function initClawBotSender(url: string, token: string): void {
  apiUrl = url;
  apiToken = token;
}

async function postMessage(chatId: string, text: string): Promise<boolean> {
  if (getChannelState() !== 'connected') {
    log.warn('ClawBot not connected, cannot send message');
    return false;
  }

  try {
    const url = `${apiUrl}/ilink/bot/sendmessage?bot_token=${encodeURIComponent(apiToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'AuthorizationType': 'ilink_bot_token',
        'iLink-App-Id': 'bot',
        'iLink-App-ClientVersion': '131588',
        'X-WECHAT-UIN': randomUUID(),
      },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const data = await res.json() as Record<string, unknown>;
    const ok = data.ok === true || data.ret === 0 || data.ret === '0';
    if (!ok) {
      log.error(`ClawBot sendmessage failed: ${JSON.stringify(data).substring(0, 300)}`);
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
export async function sendTextReply(chatId: string, text: string): Promise<void> {
  const plainText = toReplyPlainText(text);
  const parts = splitLongContent(plainText, MAX_CLAWBOT_MESSAGE_LENGTH);

  if (parts.length === 1) {
    log.info(`Sending ClawBot reply to chatId=${chatId}, len=${plainText.length}`);
    await postMessage(chatId, plainText);
    return;
  }

  log.info(`Sending ClawBot reply in ${parts.length} parts to chatId=${chatId}, totalLen=${plainText.length}`);
  for (let i = 0; i < parts.length; i++) {
    const partText = i === 0
      ? `${parts[i]}\n\n_(1/${parts.length})_`
      : `_(续 ${i + 1}/${parts.length})_\n\n${parts[i]}`;
    await postMessage(chatId, partText);
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
