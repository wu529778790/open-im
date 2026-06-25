/**
 * Shared factory for creating the per-platform event context objects.
 *
 * Every platform's `setup*Handlers` creates the same 4 objects:
 *   AccessControl, RequestQueue, runningTasks Map, CommandHandler.
 * This factory centralises that logic so each platform handler only
 * needs to provide its `allowedUserIds` array and a `sender` object.
 */

import type { Config, Platform } from '../config.js';
import type { SessionManager } from '../session/session-manager.js';
import { AccessControl } from '../access/access-control.js';
import { RequestQueue } from '../queue/request-queue.js';
import { CommandHandler, type MessageSender } from '../commands/handler.js';
import type { TaskRunState } from '../shared/ai-task.js';

/** 触发 worker 重启（写重启标志 + 优雅关闭）。由 worker 注入，命令处理器调用。 */
export type RequestRestartFn = (reason: string) => Promise<void>;

export interface CreateEventContextDeps {
  platform: Platform;
  allowedUserIds: string[];
  config: Config;
  sessionManager: SessionManager;
  sender: MessageSender;
  /** 触发 /restart 的回调。 */
  requestRestart: RequestRestartFn;
}

export interface PlatformEventContext {
  accessControl: AccessControl;
  requestQueue: RequestQueue;
  runningTasks: Map<string, TaskRunState>;
  commandHandler: CommandHandler;
}

export function createPlatformEventContext(
  deps: CreateEventContextDeps,
): PlatformEventContext {
  const { allowedUserIds, config, sessionManager, sender, requestRestart } = deps;

  const accessControl = new AccessControl(allowedUserIds);
  const requestQueue = new RequestQueue();
  const runningTasks = new Map<string, TaskRunState>();

  const commandHandler = new CommandHandler({
    config,
    sessionManager,
    requestQueue,
    sender,
    getRunningTasksSize: () => runningTasks.size,
    requestRestart,
  });

  return {
    accessControl,
    requestQueue,
    runningTasks,
    commandHandler,
  };
}
