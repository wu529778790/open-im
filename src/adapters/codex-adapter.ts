/**
 * Codex Adapter - run tasks through OpenAI Codex CLI (`codex exec`)
 */

import { runCodex } from "../codex/cli-runner.js";
import { isSessionInvalidMessage } from "../shared/session-invalid-detector.js";
import type {
  RunCallbacks,
  RunHandle,
  RunOptions,
  ToolAdapter,
} from "./tool-adapter.interface.js";

export class CodexAdapter implements ToolAdapter {
  readonly toolId = "codex";
  readonly interactionMode = "open";

  constructor(private cliPath: string) {}

  run(
    prompt: string,
    sessionId: string | undefined,
    workDir: string,
    callbacks: RunCallbacks,
    options?: RunOptions
  ): RunHandle {
    const opts = {
      skipPermissions: options?.skipPermissions,
      permissionMode: options?.permissionMode,
      model: options?.model,
      chatId: options?.chatId,
      hookPort: options?.hookPort,
      proxy: options?.proxy,
    };

    return runCodex(
      this.cliPath,
      prompt,
      sessionId,
      workDir,
      {
        onText: callbacks.onText,
        onThinking: callbacks.onThinking,
        onToolUse: callbacks.onToolUse,
        onComplete: callbacks.onComplete,
        onError: (err) => {
          const msg = typeof err === "string" ? err : String(err);
          const friendly = isSessionInvalidMessage(msg)
                ? "Codex 会话已失效，旧 session 已清理。请直接重试当前请求。"
                : msg;
          callbacks.onError(friendly);
        },
        onSessionId: callbacks.onSessionId,
        onSessionInvalid: callbacks.onSessionInvalid,
      },
      opts
    );
  }
}
