import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

// Mock the logger so tests don't write to disk/console
vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  emitStructuredEvent: vi.fn(),
}));

import { emitStructuredEvent } from '../logger.js';
import { startTaskCleanup, emitInterruptedTerminals } from './task-cleanup.js';
import type { TaskRunState } from './ai-task.js';

function makeTaskState(startedAt: number): TaskRunState {
  return {
    handle: { abort: vi.fn() },
    latestContent: '',
    settle: vi.fn(),
    startedAt,
    toolId: 'claude',
    taskKey: 'task-key',
    platform: 'telegram',
    userKey: 'hashed-user',
  };
}

describe('startTaskCleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should remove stale tasks older than 30 minutes', () => {
    const runningTasks = new Map<string, TaskRunState>();
    const now = Date.now();
    const staleTask = makeTaskState(now - 31 * 60 * 1000); // 31 minutes ago
    const freshTask = makeTaskState(now - 10 * 60 * 1000); // 10 minutes ago

    runningTasks.set('stale-1', staleTask);
    runningTasks.set('fresh-1', freshTask);

    const stopCleanup = startTaskCleanup(runningTasks);

    // Advance time by 5 minutes to trigger the first cleanup interval
    vi.advanceTimersByTime(5 * 60 * 1000);

    expect(staleTask.handle.abort).toHaveBeenCalled();
    expect(runningTasks.has('stale-1')).toBe(false);
    expect(runningTasks.has('fresh-1')).toBe(true);
    expect(runningTasks.size).toBe(1);

    stopCleanup();
  });

  it('should NOT remove fresh tasks', () => {
    const runningTasks = new Map<string, TaskRunState>();
    const now = Date.now();
    const task1 = makeTaskState(now - 5 * 60 * 1000); // 5 minutes ago
    const task2 = makeTaskState(now - 15 * 60 * 1000); // 15 minutes ago

    runningTasks.set('task-1', task1);
    runningTasks.set('task-2', task2);

    const stopCleanup = startTaskCleanup(runningTasks);

    // Advance time by 5 minutes to trigger cleanup
    vi.advanceTimersByTime(5 * 60 * 1000);

    expect(runningTasks.has('task-1')).toBe(true);
    expect(runningTasks.has('task-2')).toBe(true);
    expect(runningTasks.size).toBe(2);

    stopCleanup();
  });

  it('should stop cleanup when stop function is called', () => {
    const runningTasks = new Map<string, TaskRunState>();
    const now = Date.now();

    const stopCleanup = startTaskCleanup(runningTasks);

    // Add a task that will become stale after stop
    const staleTask = makeTaskState(now - 20 * 60 * 1000); // 20 minutes ago
    runningTasks.set('task-1', staleTask);

    // Stop cleanup
    stopCleanup();

    // Advance well past 30 minutes total age + 5 min interval
    vi.advanceTimersByTime(15 * 60 * 1000);

    // Task should still be there because cleanup was stopped
    expect(runningTasks.has('task-1')).toBe(true);
    expect(staleTask.handle.abort).not.toHaveBeenCalled();
  });
});

describe('emitInterruptedTerminals', () => {
  beforeEach(() => {
    vi.mocked(emitStructuredEvent).mockClear();
  });

  it('emits one interrupted ai.task.error per in-flight task', () => {
    const now = Date.now();
    const runningTasks = new Map<string, TaskRunState>([
      ['t1', { ...makeTaskState(now - 5_000), taskKey: 't1', toolId: 'claude' }],
      ['t2', { ...makeTaskState(now - 8_000), taskKey: 't2', toolId: 'codex' }],
    ]);

    emitInterruptedTerminals(runningTasks);

    expect(emitStructuredEvent).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(emitStructuredEvent).mock.calls;
    expect(calls.every((c) => c[0] === 'AITask' && c[1] === 'ai.task.error')).toBe(true);
    const data = calls.map((c) => c[2]);
    expect(data).toContainEqual(
      expect.objectContaining({
        taskKey: 't1',
        toolId: 'claude',
        errorType: 'interrupted',
        errorSnippet: 'interrupted',
      })
    );
    expect(data).toContainEqual(
      expect.objectContaining({
        taskKey: 't2',
        toolId: 'codex',
        errorType: 'interrupted',
      })
    );
  });

  it('computes durationMs from startedAt', () => {
    const startedAt = Date.now() - 12_000;
    const runningTasks = new Map<string, TaskRunState>([
      ['t1', { ...makeTaskState(startedAt), taskKey: 't1' }],
    ]);

    emitInterruptedTerminals(runningTasks);

    const data = vi.mocked(emitStructuredEvent).mock.calls[0][2] as Record<string, unknown>;
    expect(typeof data.durationMs).toBe('number');
    expect(data.durationMs).toBeGreaterThanOrEqual(11_000);
  });

  it('emits nothing for an empty map', () => {
    emitInterruptedTerminals(new Map<string, TaskRunState>());
    expect(emitStructuredEvent).not.toHaveBeenCalled();
  });

  it('passes platform and userKey through from the task state', () => {
    const runningTasks = new Map<string, TaskRunState>([
      [
        't1',
        {
          ...makeTaskState(Date.now()),
          taskKey: 't1',
          platform: 'feishu',
          userKey: 'user-hash-42',
        },
      ],
    ]);

    emitInterruptedTerminals(runningTasks);

    const data = vi.mocked(emitStructuredEvent).mock.calls[0][2] as Record<string, unknown>;
    expect(data.platform).toBe('feishu');
    expect(data.userKey).toBe('user-hash-42');
  });
});
