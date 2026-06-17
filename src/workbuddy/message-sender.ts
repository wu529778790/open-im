/**
 * WorkBuddy Message Sender - Send responses to WeChat KF
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '../logger.js';
import { splitLongContent, toReplyPlainText } from '../shared/utils.js';
import { MAX_WORKBUDDY_MESSAGE_LENGTH } from '../constants.js';
import { getCentrifugeClient } from './client.js';
import type { WorkBuddyCentrifugeClient } from './centrifuge-client.js';

const log = createLogger('WorkBuddySender');

/**
 * Send text reply to WeChat KF, splitting long messages automatically.
 */
export async function sendTextReply(
  _client: WorkBuddyCentrifugeClient | null,
  chatId: string,
  text: string,
  msgId: string,
): Promise<void> {
  const client = _client ?? getCentrifugeClient();
  if (!client) {
    log.warn('WorkBuddy client not available, cannot send reply');
    return;
  }

  const plainText = toReplyPlainText(text);
  const parts = splitLongContent(plainText, MAX_WORKBUDDY_MESSAGE_LENGTH);

  if (parts.length === 1) {
    log.info(`Sending WorkBuddy reply to chatId=${chatId}, msgId=${msgId}, len=${plainText.length}`);
    await client.sendPromptResponse({
      session_id: chatId,
      prompt_id: msgId,
      content: [{ type: 'text', text: plainText }],
      stop_reason: 'end_turn',
    });
    return;
  }

  log.info(`Sending WorkBuddy reply in ${parts.length} parts to chatId=${chatId}, msgId=${msgId}, totalLen=${plainText.length}`);
  for (let i = 0; i < parts.length; i++) {
    const partText = i === 0
      ? `${parts[i]}\n\n_(1/${parts.length})_`
      : `_(续 ${i + 1}/${parts.length})_\n\n${parts[i]}`;
    const partMsgId = i === 0 ? msgId : randomUUID();
    await client.sendPromptResponse({
      session_id: chatId,
      prompt_id: partMsgId,
      content: [{ type: 'text', text: partText }],
      stop_reason: 'end_turn',
    });
    log.info(`WorkBuddy part ${i + 1}/${parts.length} sent, msgId=${partMsgId}`);
  }
}

/**
 * Send error response to WeChat KF
 */
export async function sendErrorReply(
  _client: WorkBuddyCentrifugeClient | null,
  chatId: string,
  error: string,
  msgId: string,
): Promise<void> {
  const client = _client ?? getCentrifugeClient();
  if (!client) {
    log.warn('WorkBuddy client not available, cannot send error');
    return;
  }

  log.warn(`Sending WorkBuddy error to chatId=${chatId}, msgId=${msgId}`);

  await client.sendPromptResponse({
    session_id: chatId,
    prompt_id: msgId,
    error,
    stop_reason: 'error',
  });
}

/**
 * Send streaming chunk to WeChat KF
 */
function sendStreamingChunk(
  _client: WorkBuddyCentrifugeClient | null,
  chatId: string,
  text: string,
  msgId: string,
): void {
  const client = _client ?? getCentrifugeClient();
  if (!client) {
    log.warn('WorkBuddy client not available, cannot send chunk');
    return;
  }

  client.sendMessageChunk(chatId, msgId, { type: 'text', text: toReplyPlainText(text) });
}
