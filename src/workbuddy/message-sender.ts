/**
 * WorkBuddy Message Sender - Send responses to WeChat KF
 */

import { createLogger } from '../logger.js';
import { toReplyPlainText } from '../shared/utils.js';
import { getCentrifugeClient } from './client.js';
import type { WorkBuddyCentrifugeClient } from './centrifuge-client.js';

const log = createLogger('WorkBuddySender');

/**
 * Send text reply to WeChat KF.
 * 不拆分消息，直接发送完整内容（微信客服会自动截断过长的消息）
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

  log.info(`Sending WorkBuddy reply to chatId=${chatId}, msgId=${msgId}, len=${plainText.length}`);
  await client.sendPromptResponse({
    session_id: chatId,
    prompt_id: msgId,
    content: [{ type: 'text', text: plainText }],
    stop_reason: 'end_turn',
  });
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
