import { createLogger } from '../logger.js';

const log = createLogger('Queue');

interface QueuedTask {
  prompt: string;
  execute: (prompt: string, signal: AbortSignal) => Promise<void>;
  enqueuedAt: number;
}

interface UserQueue {
  running: boolean;
  tasks: QueuedTask[];
}

const MAX_QUEUE_SIZE = 3;

export type EnqueueResult = 'running' | 'queued' | 'rejected';

export class RequestQueue {
  private queues = new Map<string, UserQueue>();
  /** AbortController for the task currently running per user (key = userId). */
  private runningControllers = new Map<string, AbortController>();

  /**
   * Enqueue an AI task. Tasks are serialized per `userId` only — `convId` is ignored for queue
   * partitioning so that `/new` and `/cd` (which change `convId`) cannot leave a long-running
   * request on the old conversation executing in parallel with new messages.
   */
  enqueue(userId: string, _convId: string, prompt: string, execute: (prompt: string, signal: AbortSignal) => Promise<void>): EnqueueResult {
    const key = userId;
    let q = this.queues.get(key);
    if (!q) {
      q = { running: false, tasks: [] };
      this.queues.set(key, q);
    }
    if (q.running && q.tasks.length >= MAX_QUEUE_SIZE) return 'rejected';
    if (q.running) {
      q.tasks.push({ prompt, execute, enqueuedAt: Date.now() });
      log.info(`Queued task for ${key}`);
      return 'queued';
    }
    q.running = true;
    this.run(key, prompt, execute).catch((err) => {
      log.error(`Unhandled error in task execution for ${key}:`, err);
    });
    return 'running';
  }

  /**
   * Abort the running task for this user (if any) and drop all queued tasks.
   * Used when `/new`, `/cd`, or `/resume` changes conversation state so stale completions
   * are not delivered to the wrong WeChat/Telegram message.
   */
  cancelUser(userId: string): void {
    const key = userId;
    const c = this.runningControllers.get(key);
    if (c) {
      c.abort();
    }
    const q = this.queues.get(key);
    if (!q) return;
    const cleared = q.tasks.length;
    q.tasks.length = 0;
    if (cleared > 0) log.info(`cancelUser: dropped ${cleared} queued task(s) for ${key}`);
  }

  /** 清除指定用户的所有排队任务（不中止正在运行的任务）。`convId` 仅保留兼容签名。 */
  clear(userId: string, _convId: string): number {
    const key = userId;
    const q = this.queues.get(key);
    if (!q) return 0;
    const cleared = q.tasks.length;
    q.tasks.length = 0;
    if (cleared > 0) log.info(`Cleared ${cleared} queued tasks for ${key}`);
    return cleared;
  }

  private async run(key: string, prompt: string, execute: (prompt: string, signal: AbortSignal) => Promise<void>): Promise<void> {
    const controller = new AbortController();
    this.runningControllers.set(key, controller);
    try {
      await execute(prompt, controller.signal);
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      if (aborted) {
        log.debug(`Task aborted for ${key}`);
      } else {
        log.error(`Error executing task for ${key}:`, err);
        throw err;
      }
    } finally {
      this.runningControllers.delete(key);
      const q = this.queues.get(key);
      if (!q) { /* queue already cleared */ } else {
        const next = q.tasks.shift();
        if (next) {
          setImmediate(() => this.run(key, next.prompt, next.execute).catch((err) => {
            log.error(`Unhandled error in next task execution for ${key}:`, err);
          }));
        } else {
          q.running = false;
          this.queues.delete(key);
        }
      }
    }
  }
}
