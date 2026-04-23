import { describe, expect, it, vi } from "vitest";

const { runCodexMock } = vi.hoisted(() => ({
  runCodexMock: vi.fn(),
}));

vi.mock("../codex/cli-runner.js", () => ({
  runCodex: runCodexMock,
}));

import { CodexAdapter } from "./codex-adapter.js";

describe("CodexAdapter", () => {
  it("preserves invalid API key errors", () => {
    runCodexMock.mockImplementation((_cliPath, _prompt, _sessionId, _workDir, callbacks) => {
      callbacks.onError('unexpected status 401 Unauthorized: {"error":"Invalid API key"}');
      return { abort: vi.fn() };
    });

    const onError = vi.fn();
    const adapter = new CodexAdapter("codex");
    adapter.run("hello", undefined, "/tmp", {
      onText: vi.fn(),
      onComplete: vi.fn(),
      onError,
    });

    expect(onError).toHaveBeenCalledWith(
      'unexpected status 401 Unauthorized: {"error":"Invalid API key"}',
    );
  });

  it("preserves missing token data errors", () => {
    runCodexMock.mockImplementation((_cliPath, _prompt, _sessionId, _workDir, callbacks) => {
      callbacks.onError("Token data is not available.");
      return { abort: vi.fn() };
    });

    const onError = vi.fn();
    const adapter = new CodexAdapter("codex");
    adapter.run("hello", undefined, "/tmp", {
      onText: vi.fn(),
      onComplete: vi.fn(),
      onError,
    });

    expect(onError).toHaveBeenCalledWith("Token data is not available.");
  });

  it("preserves network errors", () => {
    runCodexMock.mockImplementation((_cliPath, _prompt, _sessionId, _workDir, callbacks) => {
      callbacks.onError("error sending request");
      return { abort: vi.fn() };
    });

    const onError = vi.fn();
    const adapter = new CodexAdapter("codex");
    adapter.run("hello", undefined, "/tmp", {
      onText: vi.fn(),
      onComplete: vi.fn(),
      onError,
    });

    expect(onError).toHaveBeenCalledWith("error sending request");
  });

  it("still maps invalid sessions to the reset guidance", () => {
    runCodexMock.mockImplementation((_cliPath, _prompt, _sessionId, _workDir, callbacks) => {
      callbacks.onError("No conversation found");
      return { abort: vi.fn() };
    });

    const onError = vi.fn();
    const adapter = new CodexAdapter("codex");
    adapter.run("hello", undefined, "/tmp", {
      onText: vi.fn(),
      onComplete: vi.fn(),
      onError,
    });

    expect(onError).toHaveBeenCalledWith(
      "Codex 会话已失效，旧 session 已清理。请直接重试当前请求。",
    );
  });
});
