/**
 * ClawBot Event Handler - Handle messages from iLink API long-polling
 */

import type { Config } from '../config.js';
import type { SessionManager } from '../session/session-manager.js';
import { sendTextReply, sendErrorReply } from './message-sender.js';
import { startTaskCleanup } from '../shared/task-cleanup.js';
import { CLAWBOT_THROTTLE_MS } from '../constants.js';
import { createLogger } from '../logger.js';
import { createPlatformEventContext } from '../platform/create-event-context.js';
import { createPlatformAIRequestHandler, type PlatformSender } from '../platform/handle-ai-request.js';
import { handleTextFlow } from '../platform/handle-text-flow.js';

const log = createLogger('ClawBotHandler');

export interface ClawBotEventHandlerHandle {
  stop: () => void;
  runningTasks: Map<string, import('../shared/ai-task.js').TaskRunState>;
  getRunningTaskCount: () => number;
  handleEvent: (chatId: string, msgId: string, content: string, imagePaths?: string[]) => Promise<void>;
}

export function setupClawbotHandlers(
  config: Config,
  sessionManager: SessionManager,
): ClawBotEventHandlerHandle {
  const ctx = createPlatformEventContext({
    platform: 'clawbot',
    allowedUserIds: config.clawbotAllowedUserIds,
    config,
    sessionManager,
    sender: {
      sendTextReply: async (chatId, text) => {
        await sendTextReply(chatId, text);
      },
    },
  });

  const stopTaskCleanup = startTaskCleanup(ctx.runningTasks);

  const platformSender: PlatformSender = {
    sendThinkingMessage: async (_chatId, _replyToMessageId, _toolId) => {
      return 'clawbot_no_thinking';
    },
    sendTextReply: async (chatId, text) => {
      await sendTextReply(chatId, text);
    },
    startTyping: (_chatId) => {
      return () => {};
    },
  };

  async function handleEvent(chatId: string, msgId: string, content: string, imagePaths?: string[]): Promise<void> {
    log.info(`[handleEvent] chatId=${chatId}, msgId=${msgId}, content="${content.substring(0, 100)}", images=${imagePaths?.length ?? 0}`);

    const userId = chatId;
    const text = content.trim();

    const msgIdSender: PlatformSender = {
      ...platformSender,
      sendTextReply: async (c, t) => {
        await sendTextReply(c, t);
      },
    };

    const handleAIRequest = createPlatformAIRequestHandler({
      platform: 'clawbot',
      config,
      sessionManager,
      sender: msgIdSender,
      throttleMs: CLAWBOT_THROTTLE_MS,
      runningTasks: ctx.runningTasks,
      taskKeyBuilder: (userId, _msgId) => `${userId}:${msgId}`,
      taskCallbacksFactory: ({ chatId: c }) => ({
        streamUpdate: async (content: string, toolNote?: string) => {
          // 有工具调用时，发送工具调用通知
          if (toolNote) {
            await sendTextReply(c, `⚙️ ${toolNote}`);
          }
        },
        sendComplete: async (content) => {
          await sendTextReply(c, content);
        },
        sendError: async (error) => {
          await sendErrorReply(c, error);
        },
      }),
    });

    // Prepend image paths to prompt so Claude can read them with its Read tool
    let enrichedText = text;
    if (imagePaths?.length) {
      const imgRefs = imagePaths.map(p => `[用户发送了图片: ${p}]`).join('\n');
      enrichedText = `${imgRefs}\n${text}`;
    }

    await handleTextFlow({
      platform: 'clawbot',
      userId,
      chatId,
      text: enrichedText,
      msgId,
      ctx,
      handleAIRequest,
      sendTextReply: (c, t) => sendTextReply(c, t),
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
