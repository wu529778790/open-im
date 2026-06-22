import type { OpencodeClient } from '@opencode-ai/sdk/v2/client';
import { startOpencode } from './sdk-manager.js';
import { createLogger } from '../logger.js';

const log = createLogger('OpenCodeSDKRunner');

export interface OpenCodeSdkRunCallbacks {
  onText: (accumulated: string) => void;
  onThinking?: (accumulated: string) => void;
  onToolUse?: (toolName: string, toolInput?: Record<string, unknown>) => void;
  onComplete: (result: {
    success: boolean;
    result: string;
    accumulated: string;
    cost: number;
    durationMs: number;
    model?: string;
    numTurns: number;
    toolStats: Record<string, number>;
  }) => void;
  onError: (error: string) => void;
  onSessionId?: (sessionId: string) => void;
  onSessionInvalid?: () => void;
}

export interface OpenCodeSdkRunOptions {
  skipPermissions?: boolean;
  model?: string;
}

export interface OpenCodeSdkRunHandle {
  abort: () => void;
}

const sessionCache = new Map<string, string>();

function parseModel(modelStr: string): { providerID: string; modelID: string } {
  const slashIdx = modelStr.indexOf('/');
  if (slashIdx > 0) {
    return { providerID: modelStr.slice(0, slashIdx), modelID: modelStr.slice(slashIdx + 1) };
  }
  return { providerID: 'anthropic', modelID: modelStr };
}

export async function runOpenCodeSdk(
  prompt: string,
  sessionId: string | undefined,
  workDir: string,
  callbacks: OpenCodeSdkRunCallbacks,
  options?: OpenCodeSdkRunOptions,
): Promise<OpenCodeSdkRunHandle> {
  const client = await startOpencode();
  const abortController = new AbortController();
  const startTime = Date.now();

  let currentSessionId = sessionId;

  if (!currentSessionId) {
    currentSessionId = sessionCache.get(workDir);
  }

  if (!currentSessionId) {
    try {
      const projectName = workDir.split('/').filter(Boolean).pop() || 'project';
      const result = await client.session.create({
        directory: workDir,
        title: `open-im: ${projectName}`,
      });
      currentSessionId = (result.data as { id?: string } | undefined)?.id;
      if (!currentSessionId) {
        throw new Error('Session creation returned no ID');
      }
      sessionCache.set(workDir, currentSessionId);
      callbacks.onSessionId?.(currentSessionId);
      log.info(`Created session ${currentSessionId} for ${workDir}`);
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err));
      log.error('Failed to create session:', msg);
      callbacks.onError(msg);
      return { abort: () => {} };
    }
  } else {
    log.info(`Using ${sessionId ? 'provided' : 'cached'} session ${currentSessionId}`);
  }

  let accumulatedText = '';
  let accumulatedThinking = '';
  const toolStats: Record<string, number> = {};
  let runSettled = false;

  const subscribeEvents = async () => {
    try {
      const sse = await client.global.event({ signal: abortController.signal } as never);
      for await (const raw of sse.stream as AsyncIterable<unknown>) {
        const ev = raw as {
          payload?: { type?: string; properties?: Record<string, unknown> };
        };
        const payload = ev?.payload;
        if (!payload?.properties) continue;
        if (payload.properties.sessionID !== currentSessionId) continue;

        switch (payload.type) {
          case 'session.next.text.delta': {
            const delta = payload.properties.delta as string | undefined;
            if (delta) {
              accumulatedText += delta;
              callbacks.onText(accumulatedText);
            }
            break;
          }
          case 'session.next.reasoning.delta': {
            const delta = payload.properties.delta as string | undefined;
            if (delta) {
              accumulatedThinking += delta;
              callbacks.onThinking?.(accumulatedThinking);
            }
            break;
          }
          case 'session.next.tool.called': {
            const tool = payload.properties.tool as string | undefined;
            if (tool) {
              toolStats[tool] = (toolStats[tool] || 0) + 1;
              callbacks.onToolUse?.(tool, payload.properties.input as Record<string, unknown> | undefined);
            }
            break;
          }
        }
      }
    } catch (err) {
      if (!abortController.signal.aborted) {
        log.debug('SSE stream ended:', (err as Error)?.message);
      }
    }
  };

  const background = subscribeEvents();

  try {
    const result = await client.session.prompt({
      sessionID: currentSessionId,
      directory: workDir,
      parts: [{ type: 'text' as const, text: prompt }],
      ...(options?.model ? { model: parseModel(options.model) } : {}),
    });

    abortController.abort();
    await background.catch(() => {});
    runSettled = true;

    const data = result.data as
      | { info?: { cost?: number }; parts?: Array<{ type: string; text?: string }> }
      | undefined;
    const parts = data?.parts ?? [];
    const finalText = parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text' && typeof p.text === 'string')
      .map(p => p.text)
      .join('\n');
    const cost = data?.info?.cost ?? 0;

    callbacks.onComplete({
      success: true,
      result: finalText,
      accumulated: accumulatedText || finalText,
      cost,
      durationMs: Date.now() - startTime,
      numTurns: 1,
      toolStats,
    });
  } catch (err) {
    abortController.abort();
    await background.catch(() => {});
    if (runSettled) return { abort: () => {} };

    const msg = (err instanceof Error ? err.message : String(err));
    log.error('OpenCode SDK error:', msg);

    if (/session\s*(not found|expired|corrupt)|no\s*session/i.test(msg)) {
      sessionCache.delete(workDir);
      callbacks.onSessionInvalid?.();
    }

    runSettled = true;
    callbacks.onError(msg);
  }

  return {
    abort: () => {
      if (!abortController.signal.aborted) {
        abortController.abort();
        client.session.abort({ sessionID: currentSessionId! }).catch(() => {});
      }
    },
  };
}

export function clearSessionCache(workDir?: string): void {
  if (workDir) {
    sessionCache.delete(workDir);
  } else {
    sessionCache.clear();
  }
}
