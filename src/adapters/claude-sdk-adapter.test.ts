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
const mockQuery = vi.fn();
const mockListSessions = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  listSessions: (...args: unknown[]) => mockListSessions(...args),
}));

// Import after mocks are set up
import { ClaudeSDKAdapter, findLatestClaudeSession } from './claude-sdk-adapter.js';

function createMockQuery(messages: unknown[]) {
  return {
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        async next() {
          if (index < messages.length) {
            return { value: messages[index++], done: false };
          }
          return { value: undefined, done: true };
        },
      };
    },
    interrupt: vi.fn(),
    setPermissionMode: vi.fn(),
    setModel: vi.fn(),
  };
}

describe('ClaudeSDKAdapter', () => {
  let adapter: ClaudeSDKAdapter;

  beforeEach(() => {
    adapter = new ClaudeSDKAdapter();
    mockQuery.mockReset();
    mockListSessions.mockReset();
  });

  afterEach(() => {
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

    mockListSessions.mockResolvedValue([]);
    mockQuery.mockReturnValue(createMockQuery([]));

    const handle = adapter.run('test prompt', undefined, '/tmp', callbacks);

    expect(handle).toBeDefined();
    expect(typeof handle.abort).toBe('function');

    handle.abort();
  });

  it('stop() (static destroy) does not throw', () => {
    expect(() => ClaudeSDKAdapter.destroy()).not.toThrow();
  });

  it('streams text and completes successfully', async () => {
    mockListSessions.mockResolvedValue([]);
    mockQuery.mockReturnValue(createMockQuery([
      { type: 'system', subtype: 'init', session_id: 'sess-1', tools: [], plugins: [], skills: [] },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } } },
      { type: 'result', subtype: 'success', result: 'Hello world', total_cost_usd: 0.01, duration_ms: 500, num_turns: 1, errors: [], session_id: 'sess-1' },
    ]));

    const callbacks = {
      onText: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
      onSessionId: vi.fn(),
    };

    adapter.run('test prompt', undefined, '/tmp', callbacks);

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalled();
    });

    expect(callbacks.onSessionId).toHaveBeenCalledWith('sess-1');
    expect(callbacks.onText).toHaveBeenCalledWith('Hello');
    expect(callbacks.onText).toHaveBeenCalledWith('Hello world');
    expect(callbacks.onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        accumulated: 'Hello world',
        result: 'Hello world',
      })
    );
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it('calls onError when query reports error', async () => {
    mockListSessions.mockResolvedValue([]);
    mockQuery.mockReturnValue(createMockQuery([
      { type: 'result', subtype: 'error_during_execution', errors: ['Network connection failed'], duration_ms: 100, num_turns: 1, total_cost_usd: 0, session_id: 'sess-2' },
    ]));

    const callbacks = {
      onText: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };

    adapter.run('test prompt', undefined, '/tmp', callbacks);

    await vi.waitFor(() => {
      expect(callbacks.onError).toHaveBeenCalledWith('Network connection failed');
    });

    expect(callbacks.onComplete).not.toHaveBeenCalled();
  });

  it('passes sessionId to resume option', async () => {
    mockListSessions.mockResolvedValue([]);
    mockQuery.mockReturnValue(createMockQuery([
      { type: 'system', subtype: 'init', session_id: 'sess-existing', tools: [], plugins: [], skills: [] },
      { type: 'result', subtype: 'success', result: 'ok', total_cost_usd: 0, duration_ms: 1, num_turns: 1, errors: [], session_id: 'sess-existing' },
    ]));

    const callbacks = { onText: vi.fn(), onComplete: vi.fn(), onError: vi.fn() };

    adapter.run('test', 'sess-existing', '/tmp', callbacks);

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalled();
    });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          resume: 'sess-existing',
        }),
      })
    );
  });

  it('aborts the query on abort()', async () => {
    mockListSessions.mockResolvedValue([]);
    // Never-resolving query
    mockQuery.mockReturnValue(createMockQuery([]));

    const callbacks = { onText: vi.fn(), onComplete: vi.fn(), onError: vi.fn() };

    const handle = adapter.run('test', undefined, '/tmp', callbacks);
    handle.abort();

    // Should not throw
    await new Promise((r) => setTimeout(r, 50));
  });

  describe('findLatestClaudeSession', () => {
    it('returns the latest session from SDK listSessions', async () => {
      mockListSessions.mockResolvedValue([
        {
          sessionId: 'aaaa-bbbb',
          summary: 'Fix login bug',
          lastModified: 2000,
          firstPrompt: 'Fix the login bug',
          fileSize: 1024,
        },
      ]);

      const result = await findLatestClaudeSession('/test/project');

      expect(result).toBeDefined();
      expect(result!.sessionId).toBe('aaaa-bbbb');
      expect(result!.mtime).toBe(2000);
      expect(result!.size).toBe(1024);
      expect(mockListSessions).toHaveBeenCalledWith({ dir: '/test/project', limit: 1 });
    });

    it('returns undefined when no sessions exist', async () => {
      mockListSessions.mockResolvedValue([]);

      const result = await findLatestClaudeSession('/test/empty');
      expect(result).toBeUndefined();
    });

    it('returns undefined on SDK error', async () => {
      mockListSessions.mockRejectedValue(new Error('SDK error'));

      const result = await findLatestClaudeSession('/test/project');
      expect(result).toBeUndefined();
    });
  });

  describe('listSessionsForDir', () => {
    it('returns sessions from SDK', async () => {
      const sessions = [
        { sessionId: 's1', summary: 'Test', lastModified: 1000 },
        { sessionId: 's2', summary: 'Another', lastModified: 2000 },
      ];
      mockListSessions.mockResolvedValue(sessions);

      const result = await ClaudeSDKAdapter.listSessionsForDir('/test/project');

      expect(result).toHaveLength(2);
      expect(mockListSessions).toHaveBeenCalledWith({ dir: '/test/project', limit: 20 });
    });

    it('returns empty array on error', async () => {
      mockListSessions.mockRejectedValue(new Error('SDK error'));

      const result = await ClaudeSDKAdapter.listSessionsForDir('/test/project');
      expect(result).toHaveLength(0);
    });

    it('passes custom limit', async () => {
      mockListSessions.mockResolvedValue([]);

      await ClaudeSDKAdapter.listSessionsForDir('/test/project', 5);
      expect(mockListSessions).toHaveBeenCalledWith({ dir: '/test/project', limit: 5 });
    });
  });
});
