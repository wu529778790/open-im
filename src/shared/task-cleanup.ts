/**
 * Periodic cleanup of stale running tasks.
 *
 * Tasks older than 30 minutes are aborted and removed from the running-tasks
 * map so they never accumulate indefinitely.
 */

import type { TaskRunState } from './ai-task.js';
import { createLogger, emitStructuredEvent } from '../logger.js';

const log = createLogger('TaskCleanup');

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

export function startTaskCleanup(runningTasks: Map<string, TaskRunState>): () => void {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, state] of runningTasks) {
      if (now - state.startedAt >= STALE_THRESHOLD_MS) {
        log.warn(`Aborting stale task (forced cleanup): ${key} (age: ${Math.round((now - state.startedAt) / 1000)}s)`);
        try {
          state.handle.abort();
        } catch (err) {
          log.error(`Failed to abort stale task ${key}:`, err);
        }
        runningTasks.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);

  // Don't prevent the process from exiting
  timer.unref();

  return () => clearInterval(timer);
}

/**
 * 在进程退出（优雅关闭 / 崩溃）路径上，为仍在运行的任务补发一条终态遥测事件。
 *
 * `runningTasks` 中存在的任务代表「已发出 ai.task.start 但尚未走到 complete/error」
 * 的在途请求。正常流程会在 handle-ai-request 的 extraCleanup 里删除已结算任务，
 * 因此进入这里时剩下的就是真正被进程退出打断的任务。
 *
 * 与用户主动 `/new`、队列超时触发的 `aborted` 区分，统一用 `interrupted` 标记。
 * 补发后立即调用 state.settle() 置 settled=true：优雅关闭路径随后仍会调用
 * handle.abort()（释放底层资源），但因已 settled，abort 不会再补发一条 aborted，
 * 避免对同一任务重复计数。
 *
 * 该函数必须同步执行，且应在遥测刷盘（shutdownLoggerTelemetry）之前调用，
 * 以保证补发的事件能进入上传队列。
 */
export function emitInterruptedTerminals(runningTasks: Map<string, TaskRunState>): void {
  if (runningTasks.size === 0) return;
  const now = Date.now();
  for (const state of runningTasks.values()) {
    emitStructuredEvent('AITask', 'ai.task.error', {
      platform: state.platform,
      taskKey: state.taskKey,
      userKey: state.userKey,
      toolId: state.toolId,
      durationMs: now - state.startedAt,
      errorSnippet: 'interrupted',
      errorType: 'interrupted',
    });
    // 标记已结算，使随后 shutdown 的 abort() 跳过重复的 aborted 事件
    state.settle();
  }
}
