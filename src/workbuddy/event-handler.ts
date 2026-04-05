/**
 * WorkBuddy Event Handler - Handle WeChat KF message events from Centrifuge
 */

import type { Config } from '../config.js';
import type { SessionManager } from '../session/session-manager.js';
import { sendTextReply, sendErrorReply } from './message-sender.js';
import { startTaskCleanup } from '../shared/task-cleanup.js';
import { WORKBUDDY_THROTTLE_MS } from '../constants.js';
import { setActiveChatId } from '../shared/active-chats.js';
import { setChatUser } from '../shared/chat-user-map.js';
import { createLogger } from '../logger.js';
import { createPlatformEventContext } from '../platform/create-event-context.js';
import { createPlatformAIRequestHandler, type PlatformSender } from '../platform/handle-ai-request.js';
import { handleTextFlow } from '../platform/handle-text-flow.js';

const log = createLogger('WorkBuddyHandler');

export interface WorkBuddyEventHandlerHandle {
  stop: () => void;
  runningTasks: Map<string, import('../shared/ai-task.js').TaskRunState>;
  getRunningTaskCount: () => number;
  handleEvent: (chatId: string, msgId: string, content: string) => Promise<void>;
}

export function setupWorkBuddyHandlers(
  config: Config,
  sessionManager: SessionManager,
): WorkBuddyEventHandlerHandle {
  // Create shared platform event context
  const ctx = createPlatformEventContext({
    platform: 'workbuddy',
    allowedUserIds: config.workbuddyAllowedUserIds,
    config,
    sessionManager,
    sender: {
      sendTextReply: async (chatId, text) => {
        await sendTextReply(null, chatId, text, '');
      },
    },
  });

  // Start task cleanup
  const stopTaskCleanup = startTaskCleanup(ctx.runningTasks);

  // WorkBuddy-specific sender callbacks (no thinking message needed)
  const platformSender: PlatformSender = {
    sendThinkingMessage: async (_chatId, _replyToMessageId, _toolId) => {
      // WorkBuddy uses incoming msgId directly; no separate thinking message
      return 'workbuddy_no_thinking';
    },
    sendTextReply: async (chatId, text) => {
      await sendTextReply(null, chatId, text, '');
    },
    startTyping: (_chatId) => {
      // WorkBuddy doesn't support typing indicators
      return () => {};
    },
  };

  async function handleEvent(chatId: string, msgId: string, content: string): Promise<void> {
    log.info(`[handleEvent] chatId=${chatId}, msgId=${msgId}, content="${content.substring(0, 100)}"`);

    // Use chatId as userId for WorkBuddy (WeChat KF doesn't have separate userId)
    const userId = chatId;
    const text = content.trim();

    // Create a per-event sender that captures msgId for all replies
    const msgIdSender: PlatformSender = {
      ...platformSender,
      sendTextReply: async (c, t) => {
        await sendTextReply(null, c, t, msgId);
      },
    };

    // Create per-event handleAIRequest that captures msgId for task callbacks
    const handleAIRequest = createPlatformAIRequestHandler({
      platform: 'workbuddy',
      config,
      sessionManager,
      sender: msgIdSender,
      throttleMs: WORKBUDDY_THROTTLE_MS,
      runningTasks: ctx.runningTasks,
      taskKeyBuilder: (userId, _msgId) => `${userId}:${msgId}`,
      taskCallbacksFactory: ({ chatId: c }) => ({
        streamUpdate: async () => {
          // WorkBuddy doesn't support streaming updates via Centrifuge
        },
        sendComplete: async (content) => {
          await sendTextReply(null, c, content, msgId);
        },
        sendError: async (error) => {
          await sendErrorReply(null, c, error, msgId);
        },
      }),
    });

    // Use shared text flow with customEnqueue to carry msgId through
    await handleTextFlow({
      platform: 'workbuddy',
      userId,
      chatId,
      text,
      ctx,
      handleAIRequest,
      sendTextReply: (c, t) => sendTextReply(null, c, t, msgId),
      workDir: sessionManager.getWorkDir(userId),
      convId: sessionManager.getConvId(userId),
      accessDeniedMessage: (uid) => `抱歉，您没有访问权限。\n您的 ID: ${uid}`,
      queueFullMessage: '请求队列已满，请稍后再试。',
      queuedMessage: '您的请求已排队等待。',
    });
  }

  return {
    stop: () => stopTaskCleanup(),
    runningTasks: ctx.runningTasks,
    getRunningTaskCount: () => ctx.runningTasks.size,
    handleEvent,
  };
}
