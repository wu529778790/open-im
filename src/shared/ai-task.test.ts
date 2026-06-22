import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../permission-mode/session-mode.js", () => ({
  getPermissionMode: vi.fn(() => "ask"),
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { classifyErrorType, clearAutopilotState, getAutopilotPendingStatus, runAITask } from "./ai-task.js";
import type { ToolAdapter } from "../adapters/tool-adapter.interface.js";

describe("runAITask", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("keeps the codex session on usage limit errors", async () => {
    const clearSessionForConv = vi.fn();
    const clearActiveToolSession = vi.fn();
    const setSessionIdForConv = vi.fn();
    const sessionManager = {
      addTurnsForThread: vi.fn(() => 0),
      addTurns: vi.fn(() => 0),
      setSessionIdForThread: vi.fn(),
      setSessionIdForConv,
      clearSessionForConv,
      clearActiveToolSession,
      getModel: vi.fn(() => undefined),
      isFreshSession: vi.fn(() => false),
    };

    const streamUpdate = vi.fn();
    const sendComplete = vi.fn(async () => {});
    const sendError = vi.fn(async () => {});

    const toolAdapter: ToolAdapter = {
      toolId: "codex",
      run(_prompt, _sessionId, _workDir, callbacks) {
        callbacks.onError("You've hit your usage limit. To get more access now, send a request to your admin or try again at 12:56 PM.");
        return { abort: vi.fn() };
      },
    };

    const taskPromise = runAITask(
      {
        config: {
          platforms: {
            wework: { enabled: true, aiCommand: "codex", allowedUserIds: [] },
          },
          enabledPlatforms: ["wework"],
          claudeModel: "",
          codexProxy: "",

          dingtalkClientId: "",
          dingtalkClientSecret: "",
          qqAppId: "",
          qqSecret: "",
          weworkCorpId: "",
          weworkSecret: "",
          telegramBotToken: "",
        } as never,
        sessionManager: sessionManager as never,
      },
      {
        userId: "u1",
        chatId: "c1",
        workDir: "D:\\coding\\open-im",
        sessionId: "sess-1",
        convId: "conv-1",
        platform: "wework",
        taskKey: "task-1",
      },
      "hello",
      toolAdapter,
      {
        streamUpdate,
        sendComplete,
        sendError,
        throttleMs: 0,
        onTaskReady: vi.fn(),
      }
    );

    await taskPromise;

    expect(clearSessionForConv).not.toHaveBeenCalled();
    expect(clearActiveToolSession).not.toHaveBeenCalled();
    expect(sendComplete).not.toHaveBeenCalled();
    expect(sendError).toHaveBeenCalledOnce();
    expect(sendError).toHaveBeenCalledWith(expect.stringContaining("usage limit"));
    expect(streamUpdate).not.toHaveBeenCalled();
  });

  it("calls sendComplete on successful AI response", async () => {
    const sessionManager = {
      addTurnsForThread: vi.fn(() => 0),
      addTurns: vi.fn(() => 0),
      setSessionIdForThread: vi.fn(),
      setSessionIdForConv: vi.fn(),
      clearSessionForConv: vi.fn(),
      clearActiveToolSession: vi.fn(),
      getModel: vi.fn(() => undefined),
      isFreshSession: vi.fn(() => false),
    };

    const streamUpdate = vi.fn();
    const sendComplete = vi.fn(async () => {});
    const sendError = vi.fn(async () => {});

    const toolAdapter: ToolAdapter = {
      toolId: "claude",
      run(_prompt, _sessionId, _workDir, callbacks, _options) {
        // Simulate text streaming then completion
        callbacks.onText("Hello from AI");
        callbacks.onComplete({
          success: true,
          result: "done",
          accumulated: "Hello from AI",
          cost: 0.01,
          durationMs: 1500,
          numTurns: 1,
          toolStats: {},
        });
        return { abort: vi.fn() };
      },
    };

    const taskPromise = runAITask(
      {
        config: {
          platforms: {
            telegram: { enabled: true, aiCommand: "claude", allowedUserIds: [] },
          },
          enabledPlatforms: ["telegram"],
          claudeModel: "",
          codexProxy: "",

          dingtalkClientId: "",
          dingtalkClientSecret: "",
          qqAppId: "",
          qqSecret: "",
          weworkCorpId: "",
          weworkSecret: "",
          telegramBotToken: "",
        } as never,
        sessionManager: sessionManager as never,
      },
      {
        userId: "u1",
        chatId: "c1",
        workDir: "/tmp/project",
        sessionId: undefined,
        convId: "conv-2",
        platform: "telegram",
        taskKey: "task-2",
      },
      "hello",
      toolAdapter,
      {
        streamUpdate,
        sendComplete,
        sendError,
        throttleMs: 0,
        onTaskReady: vi.fn(),
      }
    );

    await taskPromise;

    expect(sendComplete).toHaveBeenCalledOnce();
    expect(sendComplete).toHaveBeenCalledWith(
      "Hello from AI",
      expect.any(String),
      undefined
    );
    expect(sessionManager.addTurns).toHaveBeenCalledWith("u1", 1);
    expect(sendError).not.toHaveBeenCalled();
    expect(streamUpdate).toHaveBeenCalled();
  });

  it("calls sendError when adapter reports error", async () => {
    const sessionManager = {
      addTurnsForThread: vi.fn(() => 0),
      addTurns: vi.fn(() => 0),
      setSessionIdForThread: vi.fn(),
      setSessionIdForConv: vi.fn(),
      clearSessionForConv: vi.fn(),
      clearActiveToolSession: vi.fn(),
      newSession: vi.fn(() => true),
      getModel: vi.fn(() => undefined),
      isFreshSession: vi.fn(() => false),
    };

    const streamUpdate = vi.fn();
    const sendComplete = vi.fn(async () => {});
    const sendError = vi.fn(async () => {});

    const toolAdapter: ToolAdapter = {
      toolId: "codex",
      run(_prompt, _sessionId, _workDir, callbacks) {
        callbacks.onError("Network connection failed");
        return { abort: vi.fn() };
      },
    };

    const taskPromise = runAITask(
      {
        config: {
          platforms: {
            feishu: { enabled: true, aiCommand: "codex", allowedUserIds: [] },
          },
          enabledPlatforms: ["feishu"],
          claudeModel: "",
          codexProxy: "",

          dingtalkClientId: "",
          dingtalkClientSecret: "",
          qqAppId: "",
          qqSecret: "",
          weworkCorpId: "",
          weworkSecret: "",
          telegramBotToken: "",
        } as never,
        sessionManager: sessionManager as never,
      },
      {
        userId: "u1",
        chatId: "c1",
        workDir: "/tmp/project",
        sessionId: "sess-3",
        convId: "conv-3",
        platform: "feishu",
        taskKey: "task-3",
      },
      "hello",
      toolAdapter,
      {
        streamUpdate,
        sendComplete,
        sendError,
        throttleMs: 0,
        onTaskReady: vi.fn(),
      }
    );

    await taskPromise;

    expect(sendError).toHaveBeenCalledOnce();
    expect(sendError).toHaveBeenCalledWith("Network connection failed");
    expect(sendComplete).not.toHaveBeenCalled();
    expect(streamUpdate).not.toHaveBeenCalled();
  });

  it("does not pass the Claude model to codex", async () => {
    const sessionManager = {
      addTurnsForThread: vi.fn(() => 0),
      addTurns: vi.fn(() => 0),
      setSessionIdForThread: vi.fn(),
      setSessionIdForConv: vi.fn(),
      clearSessionForConv: vi.fn(),
      clearActiveToolSession: vi.fn(),
      getModel: vi.fn(() => "MiniMax-M2.7"),
      isFreshSession: vi.fn(() => false),
    };

    const streamUpdate = vi.fn();
    const sendComplete = vi.fn(async () => {});
    const sendError = vi.fn(async () => {});
    const runOptions: unknown[] = [];

    const toolAdapter: ToolAdapter = {
      toolId: "codex",
      run(_prompt, _sessionId, _workDir, callbacks, options) {
        runOptions.push(options);
        callbacks.onComplete({
          success: true,
          result: "done",
          accumulated: "ok",
          cost: 0,
          durationMs: 1,
          numTurns: 1,
          toolStats: {},
        });
        return { abort: vi.fn() };
      },
    };

    await runAITask(
      {
        config: {
          platforms: {
            qq: { enabled: true, aiCommand: "codex", allowedUserIds: [] },
          },
          enabledPlatforms: ["qq"],
          claudeModel: "claude-opus-4-5",
          codexProxy: "",

          dingtalkClientId: "",
          dingtalkClientSecret: "",
          qqAppId: "",
          qqSecret: "",
          weworkCorpId: "",
          weworkSecret: "",
          telegramBotToken: "",
        } as never,
        sessionManager: sessionManager as never,
      },
      {
        userId: "u1",
        chatId: "c1",
        workDir: "/tmp/project",
        sessionId: undefined,
        convId: "conv-4",
        platform: "qq",
        taskKey: "task-4",
      },
      "hello",
      toolAdapter,
      {
        streamUpdate,
        sendComplete,
        sendError,
        throttleMs: 0,
        onTaskReady: vi.fn(),
      }
    );

    expect(runOptions).toHaveLength(1);
    expect(runOptions[0]).toMatchObject({ model: undefined });
    expect(sendError).not.toHaveBeenCalled();
  });

  it("edits the placeholder to a terminal state and emits aborted telemetry on abort", async () => {
    const sessionManager = {
      addTurnsForThread: vi.fn(() => 0),
      addTurns: vi.fn(() => 0),
      setSessionIdForThread: vi.fn(),
      setSessionIdForConv: vi.fn(),
      clearSessionForConv: vi.fn(),
      clearActiveToolSession: vi.fn(),
      newSession: vi.fn(() => true),
      getModel: vi.fn(() => undefined),
      isFreshSession: vi.fn(() => false),
    };

    const sendError = vi.fn(async () => {});

    // Adapter that starts but never completes on its own — only abort ends it.
    const toolAdapter: ToolAdapter = {
      toolId: "claude",
      run() {
        return { abort: vi.fn() };
      },
    };

    const controller = new AbortController();
    const taskPromise = runAITask(
      {
        config: {
          platforms: {
            telegram: { enabled: true, aiCommand: "claude", allowedUserIds: [] },
          },
          enabledPlatforms: ["telegram"],
          claudeModel: "",
          codexProxy: "",

          dingtalkClientId: "",
          dingtalkClientSecret: "",
          qqAppId: "",
          qqSecret: "",
          weworkCorpId: "",
          weworkSecret: "",
          telegramBotToken: "",
        } as never,
        sessionManager: sessionManager as never,
      },
      {
        userId: "u1",
        chatId: "c1",
        workDir: "/tmp/project",
        sessionId: undefined,
        convId: "conv-abort",
        platform: "telegram",
        taskKey: "u1:m1",
        signal: controller.signal,
      },
      "hello",
      toolAdapter,
      {
        streamUpdate: vi.fn(),
        sendComplete: vi.fn(async () => {}),
        sendError,
        throttleMs: 0,
        onTaskReady: vi.fn(),
      }
    );

    // Abort once the task has started and wired its signal listener.
    controller.abort();
    await taskPromise;

    expect(sendError).toHaveBeenCalledOnce();
    expect(sendError).toHaveBeenCalledWith("⏹️ 已取消");
  });
});

// classifyErrorType: assertions use real error signatures observed in
// logs/r2-events telemetry. When the data shows a new error shape, add a
// failing test here first, then extend classifyErrorType.
describe("classifyErrorType", () => {
  // --- branches that already exist — regression guard ---
  it("classifies usage-limit errors as limit", () => {
    expect(
      classifyErrorType(
        "You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro)"
      )
    ).toBe("limit");
  });

  it("classifies invalid-api-key errors as auth", () => {
    expect(
      classifyErrorType(
        'unexpected status 401 Unauthorized: {"error":"Invalid API key"}'
      )
    ).toBe("auth");
  });

  it("classifies unsupported-model errors as model", () => {
    expect(
      classifyErrorType(
        '{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The \'MiniMax-M2.7\' model is not supported"}}'
      )
    ).toBe("model");
  });

  it("classifies process-exit errors as process", () => {
    expect(classifyErrorType("Claude Code process exited with code 1")).toBe(
      "process"
    );
  });

  // --- live gaps observed in telemetry (these must move off "unknown") ---

  it("classifies CodeBuddy login prompt (Chinese) as auth", () => {
    expect(
      classifyErrorType("CodeBuddy 需要先登录。请在终端运行 codebuddy login。")
    ).toBe("auth");
  });

  it("classifies missing-conversation / session-not-found as session", () => {
    expect(
      classifyErrorType(
        "No conversation found with session ID: bc5c4f88-25fd-41eb-8ad0-e08233a2f006"
      )
    ).toBe("session");
  });

  it("classifies native-CLI-binary-not-found as setup", () => {
    expect(
      classifyErrorType(
        "Native CLI binary for win32-x64 not found. Reinstall @anthropic-ai/claude-agent-sdk"
      )
    ).toBe("setup");
  });

  it("classifies executable-not-found as setup", () => {
    expect(
      classifyErrorType(
        "Claude Code executable not found at /Users/mini31/opt/lib/node_modules/@wu5..."
      )
    ).toBe("setup");
  });

  it("classifies missing environment variable as setup", () => {
    expect(
      classifyErrorType("Missing environment variable: `OPENAI_API_KEY`.")
    ).toBe("setup");
  });

  it("classifies missing token as setup", () => {
    expect(classifyErrorType("Token data is not available.")).toBe("setup");
  });

  it("classifies signal-terminated (SIGKILL) as process", () => {
    expect(
      classifyErrorType("Claude Code process terminated by signal SIGKILL")
    ).toBe("process");
  });

  it("classifies exit code 143 as process", () => {
    expect(classifyErrorType("CodeBuddy CLI exited with code 143")).toBe(
      "process"
    );
  });

  it("classifies Codex network failure (Chinese) as network", () => {
    expect(
      classifyErrorType(
        "Codex 网络请求失败。如无法访问 chatgpt.com，请在 tools.codex.proxy 或 CODEX_PROXY 中配置代理。"
      )
    ).toBe("network");
  });

  it("classifies empty-output termination as empty_output", () => {
    expect(
      classifyErrorType("AI 响应异常结束（无输出），请重试")
    ).toBe("empty_output");
  });
});

describe("autopilot interceptor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    clearAutopilotState("u1");
    vi.useRealTimers();
  });

  const baseConfig = {
    platforms: {
      telegram: { enabled: true, aiCommand: "claude" as const, allowedUserIds: [] },
    },
    enabledPlatforms: ["telegram"] as const,
    claudeModel: "",
    codexProxy: "",
    dingtalkClientId: "",
    dingtalkClientSecret: "",
    qqAppId: "",
    qqSecret: "",
    weworkCorpId: "",
    weworkSecret: "",
    telegramBotToken: "",
    autopilot: {
      enabled: true,
      maxRetries: 5,
      defaultIntervalHours: 5,
      shortRetrySeconds: 60,
      autoResumePrompt: "继续",
    },
  };

  const baseSessionManager = {
    addTurnsForThread: vi.fn(() => 0),
    addTurns: vi.fn(() => 0),
    setSessionIdForThread: vi.fn(),
    setSessionIdForConv: vi.fn(),
    clearSessionForConv: vi.fn(),
    clearActiveToolSession: vi.fn(),
    getModel: vi.fn(() => undefined),
    isFreshSession: vi.fn(() => false),
  };

  it("detects rate limit and notifies user with status message", async () => {
    const onAutoPilotContinue = vi.fn();
    const sendError = vi.fn(async () => {});

    const toolAdapter: ToolAdapter = {
      toolId: "claude",
      run(_p, _s, _w, cb) {
        cb.onError("You've hit your usage limit. Try again at 3:00 PM.");
        return { abort: vi.fn() };
      },
    };

    await runAITask(
      { config: baseConfig as never, sessionManager: baseSessionManager as never, autopilot: { onAutoPilotContinue } },
      { userId: "u1", chatId: "c1", workDir: "/tmp", sessionId: "s1", platform: "telegram", taskKey: "t1" },
      "hello",
      toolAdapter,
      { streamUpdate: vi.fn(), sendComplete: vi.fn(async () => {}), sendError, throttleMs: 0, onTaskReady: vi.fn() },
    );

    expect(sendError).toHaveBeenCalledOnce();
    const msg = sendError.mock.calls[0][0] as string;
    expect(msg).toContain("⏳");
    expect(msg).toContain("会话额度限制");
    expect(msg).toContain("自动恢复");

    // pending status should be set
    const status = getAutopilotPendingStatus("u1");
    expect(status).toBeDefined();
    expect(status?.type).toBe("session_limit");
    expect(status?.retryCount).toBe(1);

    // callback should NOT have been called yet (timer hasn't fired)
    expect(onAutoPilotContinue).not.toHaveBeenCalled();
  });

  it("does not trigger autopilot when disabled", async () => {
    const onAutoPilotContinue = vi.fn();
    const sendError = vi.fn(async () => {});
    const disabledConfig = {
      ...baseConfig,
      autopilot: { ...baseConfig.autopilot, enabled: false },
    };

    const toolAdapter: ToolAdapter = {
      toolId: "claude",
      run(_p, _s, _w, cb) {
        cb.onError("You've hit your usage limit. Try again at 3:00 PM.");
        return { abort: vi.fn() };
      },
    };

    await runAITask(
      { config: disabledConfig as never, sessionManager: baseSessionManager as never, autopilot: { onAutoPilotContinue } },
      { userId: "u1", chatId: "c1", workDir: "/tmp", sessionId: "s1", platform: "telegram", taskKey: "t1" },
      "hello",
      toolAdapter,
      { streamUpdate: vi.fn(), sendComplete: vi.fn(async () => {}), sendError, throttleMs: 0, onTaskReady: vi.fn() },
    );

    const msg = sendError.mock.calls[0][0] as string;
    expect(msg).not.toContain("⏳");
    expect(onAutoPilotContinue).not.toHaveBeenCalled();
  });

  it("does not trigger autopilot when no callback provided", async () => {
    const sendError = vi.fn(async () => {});

    const toolAdapter: ToolAdapter = {
      toolId: "claude",
      run(_p, _s, _w, cb) {
        cb.onError("You've hit your usage limit. Try again at 3:00 PM.");
        return { abort: vi.fn() };
      },
    };

    await runAITask(
      { config: baseConfig as never, sessionManager: baseSessionManager as never },
      { userId: "u1", chatId: "c1", workDir: "/tmp", sessionId: "s1", platform: "telegram", taskKey: "t1" },
      "hello",
      toolAdapter,
      { streamUpdate: vi.fn(), sendComplete: vi.fn(async () => {}), sendError, throttleMs: 0, onTaskReady: vi.fn() },
    );

    const msg = sendError.mock.calls[0][0] as string;
    expect(msg).not.toContain("⏳");
  });

  it("classifies 529 overloaded as short retry", async () => {
    const onAutoPilotContinue = vi.fn();
    const sendError = vi.fn(async () => {});

    const toolAdapter: ToolAdapter = {
      toolId: "claude",
      run(_p, _s, _w, cb) {
        cb.onError("529 overloaded");
        return { abort: vi.fn() };
      },
    };

    await runAITask(
      { config: baseConfig as never, sessionManager: baseSessionManager as never, autopilot: { onAutoPilotContinue } },
      { userId: "u1", chatId: "c1", workDir: "/tmp", sessionId: "s1", platform: "telegram", taskKey: "t1" },
      "hello",
      toolAdapter,
      { streamUpdate: vi.fn(), sendComplete: vi.fn(async () => {}), sendError, throttleMs: 0, onTaskReady: vi.fn() },
    );

    const msg = sendError.mock.calls[0][0] as string;
    expect(msg).toContain("⏳");
    expect(msg).toContain("服务器过载");

    const status = getAutopilotPendingStatus("u1");
    expect(status?.type).toBe("overloaded");
  });

  it("stops retrying after maxRetries is reached", async () => {
    const onAutoPilotContinue = vi.fn();
    const sendError = vi.fn(async () => {});
    const maxedConfig = {
      ...baseConfig,
      autopilot: { ...baseConfig.autopilot, maxRetries: 2 },
    };

    // Simulate 2 prior retries
    // We can't directly set the map, but we can trigger 2 rate limit errors in sequence
    // For simplicity, just test that on the 3rd call with maxRetries=2, autopilot is skipped
    // First, manually set the counter by running 2 tasks that trigger autopilot
    // (This is a simplified test — full integration would require more setup)

    const toolAdapter: ToolAdapter = {
      toolId: "claude",
      run(_p, _s, _w, cb) {
        cb.onError("You've hit your usage limit. Try again at 3:00 PM.");
        return { abort: vi.fn() };
      },
    };

    // Run twice to increment counter to 2
    for (let i = 0; i < 2; i++) {
      sendError.mockClear();
      await runAITask(
        { config: maxedConfig as never, sessionManager: baseSessionManager as never, autopilot: { onAutoPilotContinue } },
        { userId: "u1", chatId: "c1", workDir: "/tmp", sessionId: "s1", platform: "telegram", taskKey: `t${i}` },
        "hello",
        toolAdapter,
        { streamUpdate: vi.fn(), sendComplete: vi.fn(async () => {}), sendError, throttleMs: 0, onTaskReady: vi.fn() },
      );
    }

    // 3rd attempt should skip autopilot (maxRetries=2)
    sendError.mockClear();
    await runAITask(
      { config: maxedConfig as never, sessionManager: baseSessionManager as never, autopilot: { onAutoPilotContinue } },
      { userId: "u1", chatId: "c1", workDir: "/tmp", sessionId: "s1", platform: "telegram", taskKey: "t3" },
      "hello",
      toolAdapter,
      { streamUpdate: vi.fn(), sendComplete: vi.fn(async () => {}), sendError, throttleMs: 0, onTaskReady: vi.fn() },
    );

    const msg = sendError.mock.calls[0][0] as string;
    // Should NOT contain autopilot status — just the raw error
    expect(msg).not.toContain("⏳");
    expect(msg).toContain("usage limit");
  });

  it("classifies all rate limit error patterns", () => {
    const patterns = [
      "You've hit your usage limit. Try again at 3:00 PM.",
      "429 rate_limit exceeded",
      "529 overloaded",
      "temporarily limiting requests to prevent abuse",
      "session limit reached for this model",
      "API rate limit exceeded for your account",
    ];
    for (const err of patterns) {
      expect(classifyErrorType(err)).toBe("limit");
    }
  });
});
