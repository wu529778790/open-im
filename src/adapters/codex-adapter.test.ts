import { describe, expect, it, vi } from "vitest";

const { runCodexMock } = vi.hoisted(() => ({
  runCodexMock: vi.fn(),
}));

vi.mock("../codex/cli-runner.js", () => ({
  runCodex: runCodexMock,
}));

import { CodexAdapter } from "./codex-adapter.js";

describe("CodexAdapter", () => {
  it("maps invalid API key errors to the login guidance", () => {
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
      "Codex 需要先登录。请在终端运行 codex login，或在 shell 中 export OPENAI_API_KEY。",
    );
  });

  it("maps missing token data errors to the login guidance", () => {
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

    expect(onError).toHaveBeenCalledWith(
      "Codex 需要先登录。请在终端运行 codex login，或在 shell 中 export OPENAI_API_KEY。",
    );
  });
});
