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
  let sseConnected = false;
  // 用于等待 SSE 连接就绪后再发 prompt，避免竞态
  const sseReadyResolve = (): void => { sseConnected = true; };

  const subscribeEvents = async () => {
    try {
      const sse = await client.global.event({ signal: abortController.signal } as never);
      // SSE 连接已建立，通知主流程可以开始 prompt
      sseReadyResolve();
      log.debug('SSE stream connected');
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
          case 'session.next.text.ended': {
            // text.ended 携带完整文本，作为 SSE 流的兜底
            const fullText = payload.properties.text as string | undefined;
            if (fullText && !accumulatedText) {
              accumulatedText = fullText;
              callbacks.onText(accumulatedText);
              log.debug(`SSE text.ended fallback: got ${fullText.length} chars`);
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
          case 'session.next.reasoning.ended': {
            // reasoning.ended 携带完整推理文本
            const fullReasoning = payload.properties.text as string | undefined;
            if (fullReasoning && !accumulatedThinking) {
              accumulatedThinking = fullReasoning;
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
          default:
            log.debug(`SSE unhandled event: ${payload.type}`);
            break;
        }
      }
    } catch (err) {
      if (!abortController.signal.aborted) {
        log.debug('SSE stream ended:', (err as Error)?.message);
      }
    }
  };

  const background = subscribeEvents();

  // 等待 SSE 连接就绪（最多 3 秒），避免 prompt 在 SSE 未连接时就开始
  // 如果 3 秒内 SSE 未连接，仍然继续执行（SSE 可能后续连接并补收事件）
  const sseReady = new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (sseConnected) {
        clearInterval(check);
        resolve();
      }
    }, 100);
    // 3 秒超时：SSE 可能需要重试连接，不等太久
    setTimeout(() => {
      clearInterval(check);
      if (!sseConnected) log.warn('SSE not connected within 3s, proceeding with prompt anyway');
      resolve();
    }, 3000);
  });
  await sseReady;

  try {
    const result = await client.session.prompt({
      sessionID: currentSessionId,
      directory: workDir,
      parts: [{ type: 'text' as const, text: prompt }],
      ...(options?.model ? { model: parseModel(options.model) } : {}),
    });

    // 调试：dump SDK 返回值结构
    log.info(`SDK prompt raw result: hasData=${!!result.data}, hasError=${!!result.error}, keys=${Object.keys(result).join(',')}`);
    if (result.error) {
      const errStr = result.error instanceof Error ? result.error.message : JSON.stringify(result.error).substring(0, 500);
      log.info(`SDK prompt error detail: ${errStr}`);
    }
    if (result.data) {
      const d = result.data as Record<string, unknown>;
      log.info(`SDK prompt data keys: ${Object.keys(d).join(',')}, parts count: ${Array.isArray(d.parts) ? d.parts.length : 'N/A'}, info keys: ${d.info && typeof d.info === 'object' ? Object.keys(d.info as Record<string, unknown>).join(',') : 'N/A'}`);
    }

    abortController.abort();
    await background.catch(() => {});
    runSettled = true;

    // SDK 返回 { data, error } 二元组；error 存在时 data 为 undefined
    const sdkError = result.error;
    if (sdkError) {
      const errMsg = sdkError instanceof Error ? sdkError.message : JSON.stringify(sdkError);
      log.error(`SDK prompt returned error: ${errMsg}`);
      callbacks.onError(errMsg);
      return { abort: () => {} };
    }

    const data = result.data as
      | { info?: { cost?: number }; parts?: Array<{ type: string; text?: string }> }
      | undefined;
    if (!data) {
      log.error(`SDK prompt returned no data and no error — result keys: ${Object.keys(result).join(',')}`);
      callbacks.onError('SDK 返回空数据');
      return { abort: () => {} };
    }
    const parts = data?.parts ?? [];
    const finalText = parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text' && typeof p.text === 'string')
      .map(p => p.text)
      .join('\n');
    const cost = data?.info?.cost ?? 0;

    log.info(
      `SDK prompt completed: accumulatedText=${accumulatedText.length}, finalText=${finalText.length}, parts=${parts.length}, cost=${cost}`
    );
    if (!accumulatedText && !finalText) {
      log.warn(`SDK prompt returned empty output — data keys: ${data ? Object.keys(data).join(',') : 'null'}, parts types: ${parts.map(p => p.type).join(',')}`);
    }

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
