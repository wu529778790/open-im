import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, realpathSync, rmSync, writeFileSync, mkdirSync, utimesSync } from 'node:fs';
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
import { ClaudeSDKAdapter, findLatestClaudeSession } from './claude-sdk-adapter.js';
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
          yield { type: 'unknown' } as never;
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

  describe('findLatestClaudeSession (unit)', () => {
    let tempHome: string;
    let projectDir: string;

    beforeEach(() => {
      tempHome = mkdtempSync(join(tmpdir(), 'open-im-test-home-'));
      projectDir = join(tempHome, '.claude', 'projects', '-test-project');
      mkdirSync(projectDir, { recursive: true });
    });

    afterEach(() => {
      try { rmSync(tempHome, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    function createSessionFile(sessionId: string, options?: { mtime?: number; content?: string }) {
      const filePath = join(projectDir, `${sessionId}.jsonl`);
      const content = options?.content ?? JSON.stringify({
        type: 'mode',
        mode: 'normal',
        sessionId,
      }) + '\n';
      writeFileSync(filePath, content);
      if (options?.mtime) {
        const ts = options.mtime / 1000;
        utimesSync(filePath, ts, ts);
      }
      return filePath;
    }

    it('returns the latest session by modification time', () => {
      const sessionA = '11111111-1111-1111-1111-111111111111';
      const sessionB = '22222222-2222-2222-2222-222222222222';

      createSessionFile(sessionA, { mtime: 1000 });
      createSessionFile(sessionB, { mtime: 2000 });

      const result = findLatestClaudeSession('/test/project', tempHome);

      expect(result).toBeDefined();
      expect(result!.sessionId).toBe(sessionB);
    });

    it('returns undefined when no sessions exist', () => {
      const result = findLatestClaudeSession('/test/empty', tempHome);
      expect(result).toBeUndefined();
    });

    it('returns undefined when project dir does not exist', () => {
      const result = findLatestClaudeSession('/nonexistent/path', tempHome);
      expect(result).toBeUndefined();
    });

    it('ignores non-UUID files and subdirectories', () => {
      const sessionId = '33333333-3333-3333-3333-333333333333';
      createSessionFile(sessionId, { mtime: 1000 });

      // 创建非 UUID 文件
      writeFileSync(join(projectDir, 'not-a-session.jsonl'), '{}');
      // 创建子目录
      mkdirSync(join(projectDir, 'subagents'), { recursive: true });

      const result = findLatestClaudeSession('/test/project', tempHome);

      expect(result).toBeDefined();
      expect(result!.sessionId).toBe(sessionId);
    });

    it('ignores empty session files', () => {
      const sessionA = '44444444-4444-4444-4444-444444444444';
      const sessionB = '55555555-5555-5555-5555-555555555555';

      // A 为空文件
      writeFileSync(join(projectDir, `${sessionA}.jsonl`), '');
      // B 有内容且更新
      createSessionFile(sessionB, { mtime: 2000 });

      const result = findLatestClaudeSession('/test/project', tempHome);

      expect(result).toBeDefined();
      expect(result!.sessionId).toBe(sessionB);
    });

    it('handles a single session file', () => {
      const sessionId = '66666666-6666-6666-6666-666666666666';
      createSessionFile(sessionId);

      const result = findLatestClaudeSession('/test/project', tempHome);

      expect(result).toBeDefined();
      expect(result!.sessionId).toBe(sessionId);
    });
  });
});
