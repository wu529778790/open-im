import { describe, it, expect, vi } from 'vitest';
import { CommandHandler } from './handler.js';
import type { Config } from '../config.js';
import type { SessionManager } from '../session/session-manager.js';

// CommandHandler 的依赖里，restart 相关测试只用到 sender / getRunningTasksSize / requestRestart。
// 其余依赖传最小桩即可，不被本测试触达。
function makeDeps(overrides: { runningTasks?: number; requestRestart?: (reason: string) => Promise<void> } = {}) {
  const sender = { sendTextReply: vi.fn(async () => {}) };
  const requestRestart = overrides.requestRestart ?? vi.fn(async () => {});
  return {
    deps: {
      config: { enabledPlatforms: [], platforms: {} } as unknown as Config,
      sessionManager: {} as SessionManager,
      requestQueue: { cancelUser: vi.fn() },
      sender,
      getRunningTasksSize: () => overrides.runningTasks ?? 0,
      requestRestart,
    },
    sender,
    requestRestart,
  };
}

// dispatch 需要一个 handleClaudeRequest 桩；restart 路径不会调用它。
const noopClaudeRequest = vi.fn(async () => {});

describe('CommandHandler /restart', () => {
  it('/restart (no confirm) shows prompt with running task count and does NOT call requestRestart', async () => {
    const { deps, sender, requestRestart } = makeDeps({ runningTasks: 2 });
    const handler = new CommandHandler(deps);

    const consumed = await handler.dispatch('/restart', 'chat1', 'user1', 'telegram', noopClaudeRequest);

    expect(consumed).toBe(true);
    expect(requestRestart).not.toHaveBeenCalled();
    expect(sender.sendTextReply).toHaveBeenCalledTimes(1);
    const msg = sender.sendTextReply.mock.calls[0][1] as string;
    expect(msg).toContain('2 个进行中的任务');
    expect(msg).toContain('/restart confirm');
  });

  it('/restart with zero running tasks does not show the interrupt warning line', async () => {
    const { deps, sender } = makeDeps({ runningTasks: 0 });
    const handler = new CommandHandler(deps);

    await handler.dispatch('/restart', 'chat1', 'user1', 'telegram', noopClaudeRequest);

    const msg = sender.sendTextReply.mock.calls[0][1] as string;
    expect(msg).toContain('当前无进行中的任务');
  });

  it('/restart confirm sends reply BEFORE calling requestRestart and includes user id in reason', async () => {
    const callOrder: string[] = [];
    const requestRestart = vi.fn(async (reason: string) => {
      callOrder.push(`requestRestart:${reason}`);
    });
    const sender = {
      sendTextReply: vi.fn(async () => {
        callOrder.push('sendTextReply');
      }),
    };
    const { deps } = makeDeps({ requestRestart });
    // 覆盖 sender 为带顺序追踪的版本
    (deps as { sender: typeof sender }).sender = sender;
    const handler = new CommandHandler(deps);

    const consumed = await handler.dispatch('/restart confirm', 'chat1', 'user42', 'telegram', noopClaudeRequest);

    expect(consumed).toBe(true);
    expect(requestRestart).toHaveBeenCalledTimes(1);
    // reason 必须包含触发用户 id，便于日志追溯
    expect(requestRestart.mock.calls[0][0]).toContain('user42');
    // 回复必须在 requestRestart 之前完成（否则进程退出后发不出去）
    expect(callOrder[0]).toBe('sendTextReply');
    expect(callOrder[1]).toBe('requestRestart:/restart by user user42');
  });

  it('unknown text is not consumed as a command', async () => {
    const { deps, requestRestart } = makeDeps();
    const handler = new CommandHandler(deps);

    const consumed = await handler.dispatch('hello there', 'chat1', 'user1', 'telegram', noopClaudeRequest);

    expect(consumed).toBe(false);
    expect(requestRestart).not.toHaveBeenCalled();
  });
});
