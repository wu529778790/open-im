import { describe, expect, it, vi } from "vitest";

const { runCodeBuddyMock } = vi.hoisted(() => ({
  runCodeBuddyMock: vi.fn(),
}));

vi.mock("../codebuddy/cli-runner.js", () => ({
  runCodeBuddy: runCodeBuddyMock,
}));

import { CodeBuddyAdapter } from "./codebuddy-adapter.js";

describe("CodeBuddyAdapter", () => {
  it("preserves auth errors", () => {
    runCodeBuddyMock.mockImplementation((_cliPath, _prompt, _sessionId, _workDir, callbacks) => {
      callbacks.onError("Authentication required, visit /login first");
      return { abort: vi.fn() };
    });

    const onError = vi.fn();
    const adapter = new CodeBuddyAdapter("codebuddy");
    adapter.run("hello", undefined, "/tmp", {
      onText: vi.fn(),
      onComplete: vi.fn(),
      onError,
    });

    expect(onError).toHaveBeenCalledWith("Authentication required, visit /login first");
  });

  it("still maps invalid sessions to the reset guidance", () => {
    runCodeBuddyMock.mockImplementation((_cliPath, _prompt, _sessionId, _workDir, callbacks) => {
      callbacks.onError("Session not found");
      return { abort: vi.fn() };
    });

    const onError = vi.fn();
    const adapter = new CodeBuddyAdapter("codebuddy");
    adapter.run("hello", undefined, "/tmp", {
      onText: vi.fn(),
      onComplete: vi.fn(),
      onError,
    });

    expect(onError).toHaveBeenCalledWith(
      "CodeBuddy 会话已失效，旧 session 已清理。请直接重试当前请求。",
    );
  });
});
