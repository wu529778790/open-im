import { runCodeBuddy } from '../codebuddy/cli-runner.js';
import { isSessionInvalidMessage } from '../shared/session-invalid-detector.js';
import type {
  RunCallbacks,
  RunHandle,
  RunOptions,
  ToolAdapter,
} from './tool-adapter.interface.js';

export class CodeBuddyAdapter implements ToolAdapter {
  readonly toolId = 'codebuddy';
  readonly interactionMode = 'open';

  constructor(private cliPath: string) {}

  run(
    prompt: string,
    sessionId: string | undefined,
    workDir: string,
    callbacks: RunCallbacks,
    options?: RunOptions,
  ): RunHandle {
    return runCodeBuddy(
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
          const msg = typeof err === 'string' ? err : String(err);
          const friendly = isSessionInvalidMessage(msg)
                ? 'CodeBuddy 会话已失效，旧 session 已清理。请直接重试当前请求。'
                : msg;
          callbacks.onError(friendly);
        },
        onSessionId: callbacks.onSessionId,
        onSessionInvalid: callbacks.onSessionInvalid,
      },
      {
        skipPermissions: options?.skipPermissions,
        permissionMode: options?.permissionMode,
        model: options?.model,
      },
    );
  }
}
