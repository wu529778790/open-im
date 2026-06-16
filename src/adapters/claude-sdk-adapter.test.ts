import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock the logger before importing the adapter under test
vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock the Claude Agent SDK
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  unstable_v2_createSession: vi.fn(),
  unstable_v2_resumeSession: vi.fn(),
}));

// Import after mocks are set up
import { ClaudeSDKAdapter } from './claude-sdk-adapter.js';
import { unstable_v2_createSession, unstable_v2_resumeSession } from '@anthropic-ai/claude-agent-sdk';

describe('ClaudeSDKAdapter', () => {
  let adapter: ClaudeSDKAdapter;

  beforeEach(() => {
    adapter = new ClaudeSDKAdapter();
    vi.mocked(unstable_v2_createSession).mockReset();
    vi.mocked(unstable_v2_resumeSession).mockReset();
  });

  afterEach(() => {
    // Clean up any active sessions/timers created during tests
    ClaudeSDKAdapter.destroy();
  });

  it('implements the ToolAdapter interface', () => {
    expect(adapter).toBeDefined();
    expect(typeof adapter.toolId).toBe('string');
    expect(typeof adapter.run).toBe('function');
  });

  it('has toolId set to claude-sdk', () => {
    expect(adapter.toolId).toBe('claude-sdk');
  });

  it('has a run method that returns a RunHandle', () => {
    const callbacks = {
      onText: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };

    const handle = adapter.run('test prompt', undefined, '/tmp', callbacks);

    expect(handle).toBeDefined();
    expect(typeof handle.abort).toBe('function');

    // Abort to clean up the background promise
    handle.abort();
  });

  it('stop() (static destroy) does not throw', () => {
    expect(() => ClaudeSDKAdapter.destroy()).not.toThrow();
  });

  it('includes stderr context when Claude exits with a generic code 1 error', async () => {
    vi.mocked(unstable_v2_createSession).mockImplementation((options) => {
      options.stderr?.('fatal: missing permission\n');
      return {
        send: vi.fn(async () => {}),
        close: vi.fn(),
        stream: async function* () {
          yield null;
          throw new Error('Claude Code process exited with code 1');
        },
      } as never;
    });

    const callbacks = {
      onText: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };

    adapter.run('test prompt', undefined, '/tmp', callbacks);

    await vi.waitFor(() => {
      expect(callbacks.onError).toHaveBeenCalledWith(
        expect.stringContaining('stderr: fatal: missing permission'),
      );
    });
  });

  it('serializes workDir so concurrent runs each spawn in their own cwd', async () => {
    const originalCwd = process.cwd();
    const dirA = mkdtempSync(join(tmpdir(), 'cli-cwd-a-'));
    const dirB = mkdtempSync(join(tmpdir(), 'cli-cwd-b-'));
    // process.cwd() 展开符号链接（macOS 上 /tmp → /private/tmp），用 realpath 比对
    const realA = realpathSync(dirA);
    const realB = realpathSync(dirB);
    const seenCwds: string[] = [];

    try {
      vi.mocked(unstable_v2_createSession).mockImplementation(() => {
        return {
          send: async () => {
            // 让两个并发 run 在 send() 期间重叠（无锁时会互相踩 cwd）
            await new Promise((r) => setTimeout(r, 10));
            seenCwds.push(process.cwd());
          },
          close: vi.fn(),
          stream: async function* () {
            yield {
              type: 'result',
              subtype: 'success',
              result: 'ok',
              total_cost_usd: 0,
              duration_ms: 1,
              num_turns: 1,
              errors: [],
            } as never;
          },
        } as never;
      });

      const mk = () => ({ onText: vi.fn(), onComplete: vi.fn(), onError: vi.fn() });
      const cbsA = mk();
      const cbsB = mk();
      adapter.run('p', undefined, dirA, cbsA);
      adapter.run('p', undefined, dirB, cbsB);

      await vi.waitFor(() => {
        expect(cbsA.onComplete).toHaveBeenCalled();
        expect(cbsB.onComplete).toHaveBeenCalled();
      });

      // 每个 send() 必须观测到自己的 workDir（修复前 send() 在锁外、cwd 不受控）
      expect(seenCwds).toContain(realA);
      expect(seenCwds).toContain(realB);
    } finally {
      process.chdir(originalCwd);
      try { rmSync(dirA, { recursive: true, force: true }); } catch { /* ignore */ }
      try { rmSync(dirB, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});
