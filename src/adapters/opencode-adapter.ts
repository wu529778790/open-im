/**
 * OpenCode Adapter — run tasks through OpenCode CLI (`opencode run`)
 */

import { runOpenCode } from '../opencode/cli-runner.js';
import type {
  ParsedResult,
  RunCallbacks,
  RunHandle,
  RunOptions,
  ToolAdapter,
} from './tool-adapter.interface.js';

export class OpenCodeAdapter implements ToolAdapter {
  readonly toolId = 'opencode';

  constructor(private cliPath: string) {}

  run(
    prompt: string,
    sessionId: string | undefined,
    workDir: string,
    callbacks: RunCallbacks,
    options?: RunOptions,
  ): RunHandle {
    return runOpenCode(
      this.cliPath,
      prompt,
      sessionId,
      workDir,
      {
        onText: callbacks.onText,
        onThinking: callbacks.onThinking,
        onToolUse: callbacks.onToolUse,
        onComplete: (raw) => {
          const result: ParsedResult = {
            success: raw.success,
            result: raw.result,
            accumulated: raw.accumulated,
            cost: raw.cost,
            durationMs: raw.durationMs,
            model: raw.model,
            numTurns: raw.numTurns,
            toolStats: raw.toolStats,
          };
          callbacks.onComplete(result);
        },
        onError: (err) => {
          const msg = typeof err === 'string' ? err : String(err);
          const friendly =
            msg.includes('session not found') ||
            msg.includes('Session not found') ||
            msg.includes('no sessions found')
              ? 'OpenCode 会话已失效，旧 session 已清理。请直接重试当前请求。'
              : msg;
          callbacks.onError(friendly);
        },
        onSessionId: callbacks.onSessionId,
        onSessionInvalid: callbacks.onSessionInvalid,
      },
      {
        skipPermissions: options?.skipPermissions,
        model: options?.model,
      },
    );
  }
}
