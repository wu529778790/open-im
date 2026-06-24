/**
 * 共享 AI 任务执行层，支持多 ToolAdapter。
 */

import type { Config } from '../config.js';
import type { SessionManager } from '../session/session-manager.js';
import type { RunOptions, ToolAdapter } from '../adapters/tool-adapter.interface.js';
import type { ParsedResult } from '../adapters/tool-adapter.interface.js';
import { resolvePlatformAiCommand, type Platform } from '../config.js';
import { captureError } from './sentry.js';
import {
  formatToolStats,
  formatToolCallNotification,
  getContextWarning,
  getAIToolDisplayName,
  toReplyPlainText,
} from './utils.js';
import { createLogger } from '../logger.js';
import { sanitize } from '../sanitize.js';

const log = createLogger('AITask');

/** 每用户连续 autopilot 重试计数。成功完成或遇到非限流错误时清零。 */
const autopilotRetryCount = new Map<string, number>();

/** 当前等待中的 autopilot 定时器（用于 /autopilot 状态查询）。 */
const pendingAutopilotTimers = new Map<string, { retryAt: Date; type: string; retryCount: number }>();

/** 查询指定用户的 autopilot 等待状态（供 /autopilot 命令使用）。 */
export function getAutopilotPendingStatus(userId: string): { retryAt: Date; type: string; retryCount: number } | undefined {
  return pendingAutopilotTimers.get(userId);
}

/** 清除指定用户的 autopilot 状态（测试用）。 */
export function clearAutopilotState(userId: string): void {
  autopilotRetryCount.delete(userId);
  pendingAutopilotTimers.delete(userId);
}

export interface TaskDeps {
  config: Config;
  sessionManager: SessionManager;
  /**
   * Autopilot 回调：限流恢复后调用，将 autoResumePrompt 作为新消息
   * 通过平台的请求队列重新入队。如果不提供，autopilot 不执行恢复动作。
   */
  autopilot?: {
    onAutoPilotContinue: (prompt: string) => void;
  };
}

export interface TaskContext {
  userId: string;
  chatId: string;
  workDir: string;
  sessionId: string | undefined;
  convId?: string;
  threadId?: string;
  platform: string;
  taskKey: string;
  /** AbortSignal from the request queue; fires on task timeout to abort the running SDK session */
  signal?: AbortSignal;
}

export interface TaskAdapter {
  streamUpdate(content: string, toolNote?: string): void;
  sendComplete(content: string, note: string, thinkingText?: string): Promise<void>;
  sendError(error: string): Promise<void>;
  onThinkingToText?(content: string): void;
  extraCleanup?(): void;
  throttleMs: number;
  /** 块级流式：仅当内容增长超过此字符数时才更新，减少 patch 次数。 */
  minContentDeltaChars?: number;
  onTaskReady(state: TaskRunState): void;
  onFirstContent?(): void;
  sendImage?(imagePath: string): Promise<void>;
}

export interface TaskRunState {
  handle: { abort: () => void };
  latestContent: string;
  settle: () => void;
  startedAt: number;
  /** AI 工具标识，用于动态显示工具名称。 */
  toolId: string;
  /**
   * 进程退出（shutdown / 崩溃）时，用于为仍在运行的任务补发一条终态遥测事件，
   * 避免 `ai.task.start` 没有对应的 complete/error（遥测里的 `miss`）。
   * 已哈希（与 ai.task.* emit 处一致），不含原始 userId/msgId。
   */
  taskKey: string;
  platform: string;
  /** 已哈希的 userId，与 ai.task.start/complete/error 中的 userKey 一致。 */
  userKey: string;
}

/**
 * 判断错误是否为限流类错误（用于决定是否保留 session）。
 * 覆盖所有已知的限流模式：429/529/session limit/overloaded/temporary throttle。
 */
function isUsageLimitError(error: string): boolean {
  return /usage\s*limit/i.test(error)
    || /try\s+again\s+at\s+\d{1,2}:\d{2}/i.test(error)
    || /rate\s*limit/i.test(error)
    || /\b429\b/.test(error)
    || /\b529\b/.test(error)
    || /overloaded/i.test(error)
    || /temporarily\s+limiting/i.test(error)
    || /session\s+limit/i.test(error)
    || /you['\u2019]ve\s+hit\s+your/i.test(error);
}

interface RateLimitInfo {
  detected: boolean;
  type: 'session_limit' | 'api_rate_limit' | 'overloaded' | 'temporary' | null;
  retryAt: Date | null;
  isLongWait: boolean;
}

/**
 * 从错误消息中提取限流详情。仅在 isUsageLimitError() 返回 true 后调用。
 */
function classifyRateLimit(error: string, config: Config): RateLimitInfo {
  const now = Date.now();
  const shortMs = config.autopilot.shortRetrySeconds * 1000;
  const defaultMs = config.autopilot.defaultIntervalHours * 3600 * 1000;

  // Session quota / usage limit（最常见，等待时间最长）
  if (/session\s*limit|usage\s*limit|opus\s*limit|you['\u2019]ve\s+hit\s+your/i.test(error)) {
    const timeMatch = error.match(/try\s+again\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1], 10);
      const minutes = parseInt(timeMatch[2], 10);
      const ampm = timeMatch[3]?.toUpperCase();
      if (ampm === 'PM' && hours < 12) hours += 12;
      if (ampm === 'AM' && hours === 12) hours = 0;
      const retryAt = new Date();
      retryAt.setHours(hours, minutes, 0, 0);
      if (retryAt.getTime() <= now) retryAt.setDate(retryAt.getDate() + 1);
      return { detected: true, type: 'session_limit', retryAt, isLongWait: true };
    }
    return { detected: true, type: 'session_limit', retryAt: new Date(now + defaultMs), isLongWait: true };
  }

  // 529 overloaded / temporarily limiting（短延迟）
  if (/\b529\b|overloaded|temporarily\s+limiting/i.test(error)) {
    return {
      detected: true,
      type: /overloaded/i.test(error) ? 'overloaded' : 'temporary',
      retryAt: new Date(now + shortMs),
      isLongWait: false,
    };
  }

  // 429 rate limit（使用默认周期）
  if (/\b429\b|rate\s*limit/i.test(error)) {
    return { detected: true, type: 'api_rate_limit', retryAt: new Date(now + defaultMs), isLongWait: true };
  }

  return { detected: false, type: null, retryAt: null, isLongWait: false };
}

function rateLimitTypeLabel(type: string): string {
  switch (type) {
    case 'session_limit': return '会话额度限制';
    case 'api_rate_limit': return 'API 速率限制';
    case 'overloaded': return '服务器过载';
    case 'temporary': return '临时限流';
    default: return '限流';
  }
}

function formatTimeHHMM(date: Date): string {
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '即将';
  const totalSec = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) return `${hours}小时${minutes > 0 ? `${minutes}分钟` : ''}`;
  if (minutes > 0) return `${minutes}分钟${seconds > 0 ? `${seconds}秒` : ''}`;
  return `${seconds}秒`;
}

/**
 * 将 AI/CLI 错误文本归类为一个稳定的 errorType 字符串，用于遥测聚合。
 * 分类基于线上真实错误签名（见 logs/r2-events），新增分支时同步更新测试。
 */
export function classifyErrorType(error: string): string {
  const s = error.toLowerCase();
  if (s.includes('aborted')) return 'aborted';
  // 空输出：流正常结束但无内容（claude-sdk-adapter 的兜底消息）
  if (s.includes('无输出') || s.includes('响应异常结束') || s.includes('empty output')) {
    return 'empty_output';
  }
  if (isUsageLimitError(error) || s.includes('rate limit') || s.includes('quota')) return 'limit';
  // 鉴权：凭据无效或需要登录（含中文「登录」/「login」）
  if (
    s.includes('invalid api key') ||
    s.includes('unauthorized') ||
    s.includes('401') ||
    s.includes('need to log in') ||
    s.includes('need to login') ||
    s.includes('需要登录') ||
    s.includes('需要先登录') ||
    s.includes('log in required') ||
    s.includes('login required')
  ) {
    return 'auth';
  }
  if (s.includes('model') && (s.includes('not support') || s.includes('not found') || s.includes('invalid'))) {
    return 'model';
  }
  // 安装/配置缺失：二进制或可执行文件缺失、环境变量缺失、token 未配置
  if (
    s.includes('native cli binary') ||
    s.includes('executable not found') ||
    (s.includes('binary') && s.includes('not found')) ||
    s.includes('missing environment variable') ||
    s.includes('token data is not available')
  ) {
    return 'setup';
  }
  // 会话失效：找不到会话/对话，或会话过期/损坏
  if (
    s.includes('no conversation found') ||
    s.includes('session not found') ||
    (s.includes('session') && (s.includes('expired') || s.includes('corrupt')))
  ) {
    return 'session';
  }
  // 进程退出或被信号终止
  if (
    s.includes('process exited') ||
    s.includes('exit code') ||
    s.includes('exited with code') ||
    s.includes('terminated by signal') ||
    s.includes('sigkill')
  ) {
    return 'process';
  }
  // 网络：超时/连接重置/DNS/网络请求失败（含中文「网络」）
  if (
    s.includes('timeout') ||
    s.includes('etimedout') ||
    s.includes('econnreset') ||
    s.includes('enotfound') ||
    s.includes('eai_again') ||
    s.includes('network') ||
    s.includes('网络')
  ) {
    return 'network';
  }
  return 'unknown';
}

function buildCompletionNote(
  result: ParsedResult,
  sessionManager: SessionManager,
  ctx: TaskContext
): string {
  const toolInfo = formatToolStats(result.toolStats, result.numTurns);
  const parts: string[] = [];
  parts.push(`耗时 ${(result.durationMs / 1000).toFixed(1)}s`);
  if (toolInfo) parts.push(toolInfo);
  if (result.model) parts.push(result.model);

  // 每完成一次「用户消息 → AI 回复」计 1 轮（供 /sessions、上下文提示等）
  const currentTurns = ctx.threadId
    ? sessionManager.addTurnsForThread(ctx.userId, ctx.threadId, 1)
    : sessionManager.addTurns(ctx.userId, 1);
  const ctxWarning = getContextWarning(currentTurns);
  if (ctxWarning) parts.push(ctxWarning);

  return parts.join(' | ');
}

function buildRunOptions(
  config: Config,
  sessionManager: SessionManager,
  ctx: TaskContext,
  aiCommand: string,
  toolAdapter: ToolAdapter,
): RunOptions {
  const defaultSkipPermissions =
    toolAdapter.interactionMode === 'native'
      ? false
      : (config.skipPermissions ?? true);

  return {
    model: aiCommand === 'claude'
      ? (sessionManager.getModel(ctx.userId, ctx.threadId) ?? config.claudeModel)
      : aiCommand === 'opencode'
        ? config.opencodeModel
        : undefined,
    chatId: ctx.chatId,
    skipPermissions: defaultSkipPermissions,
    skipAutoResume: sessionManager.isFreshSession(ctx.userId),
    ...(aiCommand === 'codex' && config.codexProxy ? { proxy: config.codexProxy } : {}),
  };
}

export function runAITask(
  deps: TaskDeps,
  ctx: TaskContext,
  prompt: string,
  toolAdapter: ToolAdapter,
  platformAdapter: TaskAdapter
): Promise<void> {
  const { config, sessionManager } = deps;
  return new Promise((resolve) => {
    let lastUpdateTime = 0;
    let lastSentContentLength = 0;
    let pendingUpdate: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    let firstContentLogged = false;
    let wasThinking = false;
    let thinkingText = '';
    let currentSessionId = ctx.sessionId;
    let hadSessionInvalid = false;
    let activeHandle: { abort: () => void } | null = null;
    const toolLines: string[] = [];
    const minDelta = platformAdapter.minContentDeltaChars ?? 0;

    const cleanup = () => {
      if (pendingUpdate) {
        clearTimeout(pendingUpdate);
        pendingUpdate = null;
      }
      platformAdapter.extraCleanup?.();
    };

    const settle = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    // Declared before assignment so closures can capture it; object is assigned below
    // eslint-disable-next-line prefer-const -- assigned once after closures are defined
    let taskState: TaskRunState;

    const throttledUpdate = (content: string, force = false) => {
      taskState.latestContent = content;
      const now = Date.now();
      const elapsed = now - lastUpdateTime;
      const contentDelta = content.length - lastSentContentLength;
      const shouldUpdateByTime = elapsed >= platformAdapter.throttleMs;
      const shouldUpdateByContent = minDelta > 0 && contentDelta >= minDelta;

      if (force || shouldUpdateByTime || shouldUpdateByContent) {
        lastUpdateTime = now;
        lastSentContentLength = content.length;
        if (pendingUpdate) {
          clearTimeout(pendingUpdate);
          pendingUpdate = null;
        }
        // 只在 force=true（工具调用）时传 toolNote，普通文本更新不传
        const toolNote = force && toolLines.length > 0 ? toolLines.slice(-3).join('\n') : undefined;
        platformAdapter.streamUpdate(content, toolNote);
      } else if (!pendingUpdate) {
        pendingUpdate = setTimeout(() => {
          pendingUpdate = null;
          lastUpdateTime = Date.now();
          lastSentContentLength = taskState.latestContent.length;
          platformAdapter.streamUpdate(taskState.latestContent, undefined);
        }, platformAdapter.throttleMs - elapsed);
      }
    };

    // 使用 aiCommand 而不是 toolAdapter.toolId，确保 sessionId 的存储和查询使用相同的 key
    const aiCommand = resolvePlatformAiCommand(config, ctx.platform as Platform);

    const startRun = () => {
      log.info(`[AITask] Starting: userId=${ctx.userId}, initialSessionId=${currentSessionId ?? 'new'}, prompt="${prompt.slice(0, 50)}..."`);

      activeHandle = toolAdapter.run(
        prompt,
        currentSessionId,
        ctx.workDir,
        {
        onSessionId: (id) => {
          log.info(`[AITask] SessionId callback: old=${currentSessionId ?? 'none'}, new=${id}, aiCommand=${aiCommand}, userId=${ctx.userId}`);
          currentSessionId = id;
          // 使用 aiCommand 而不是 toolId，确保与查询时使用相同的 key
          if (ctx.threadId) sessionManager.setSessionIdForThread(ctx.userId, ctx.threadId, aiCommand, id);
          else if (ctx.convId) sessionManager.setSessionIdForConv(ctx.userId, ctx.convId, aiCommand, id);
          else log.info(`[AITask] No threadId or convId, sessionId not persisted to storage`);
        },
        onSessionInvalid: () => {
          hadSessionInvalid = true;
          if (ctx.convId) sessionManager.clearSessionForConv(ctx.userId, ctx.convId, aiCommand);
          const ok = sessionManager.newSession(ctx.userId);
          log.info(
            `[AITask] Session invalid for user ${ctx.userId}, aiCommand=${aiCommand}; auto /new applied, ok=${ok}`
          );
        },
        onThinking: (t) => {
          if (!firstContentLogged) {
            firstContentLogged = true;
            platformAdapter.onFirstContent?.();
          }
          wasThinking = true;
          thinkingText = t;
          throttledUpdate(`💭 **${getAIToolDisplayName(aiCommand)} 思考中...**\n\n${t}`);
        },
        onText: (accumulated) => {
          if (!firstContentLogged) {
            firstContentLogged = true;
            platformAdapter.onFirstContent?.();
          }
          if (wasThinking && platformAdapter.onThinkingToText) {
            wasThinking = false;
            if (pendingUpdate) {
              clearTimeout(pendingUpdate);
              pendingUpdate = null;
            }
            lastUpdateTime = Date.now();
            taskState.latestContent = accumulated;
            platformAdapter.onThinkingToText(accumulated);
            return;
          }
          wasThinking = false;
          throttledUpdate(accumulated);
        },
        onToolUse: (toolName, toolInput) => {
          const notification = formatToolCallNotification(toolName, toolInput);
          toolLines.push(notification);
          if (toolLines.length > 5) toolLines.shift();
          // 不强制发送（force=false），让节流机制合并短时间内的多次工具调用，
          // 避免突发大量消息触发平台频率限制（如 ClawBot ret=-2）。
          throttledUpdate(taskState.latestContent, false);
        },
        onComplete: async (result) => {
          log.info(`[AITask] onComplete fired: settled=${settled}, success=${result.success}, platform=${ctx.platform}, taskKey=${ctx.taskKey}`);
          if (settled) return;
          settled = true;
          // 成功完成 → 清除 autopilot 重试计数
          autopilotRetryCount.delete(ctx.userId);
          if (pendingUpdate) {
            clearTimeout(pendingUpdate);
            pendingUpdate = null;
          }
          const note = buildCompletionNote(result, sessionManager, ctx);
          const raw =
            result.accumulated ||
            result.result ||
            taskState.latestContent ||
            '';
          const output = raw ? toReplyPlainText(raw) : '(无输出)';
          if (!result.accumulated && !result.result && taskState.latestContent) {
            log.warn(
              `Empty AI output from adapter but had streamed content (${taskState.latestContent.length} chars), using latestContent. platform=${ctx.platform}, taskKey=${ctx.taskKey}`
            );
          } else if (!output || output === '(无输出)') {
            log.warn(
              `Empty AI output for user ${ctx.userId}, platform=${ctx.platform}, taskKey=${ctx.taskKey}`
            );
          }
          const sendCompleteWithRetry = async (attempt = 1): Promise<void> => {
            const maxAttempts = 2;
            try {
              await platformAdapter.sendComplete(output, note, thinkingText || undefined);
            } catch (err) {
              log.error(`Failed to send complete (attempt ${attempt}/${maxAttempts}):`, err);
              if (attempt < maxAttempts) {
                await new Promise((r) => setTimeout(r, 2000));
                return sendCompleteWithRetry(attempt + 1);
              }
              try {
                await platformAdapter.sendError(
                  '回复发送失败（网络异常），请重试。若多次出现可检查本机网络或稍后再试。'
                );
              } catch (sendErr) {
                log.error('Failed to send error fallback:', sendErr);
              }
            }
          };
          try {
            await sendCompleteWithRetry();
          } finally {
            cleanup();
            resolve();
          }
        },
        onError: async (error) => {
          if (settled) return;
          if (pendingUpdate) {
            clearTimeout(pendingUpdate);
            pendingUpdate = null;
          }
          settled = true;
          log.error(`Task error for user ${ctx.userId}: ${error}`);

          // ── Autopilot 拦截 ──
          const apConfig = config.autopilot;
          const currentRetries = autopilotRetryCount.get(ctx.userId) ?? 0;

          if (
            apConfig?.enabled &&
            deps.autopilot &&
            isUsageLimitError(error) &&
            currentRetries < apConfig.maxRetries
          ) {
            const rateInfo = classifyRateLimit(error, config);

            if (rateInfo.detected && rateInfo.retryAt) {
              const retryCount = currentRetries + 1;
              autopilotRetryCount.set(ctx.userId, retryCount);

              // 记录等待状态
              pendingAutopilotTimers.set(ctx.userId, {
                retryAt: rateInfo.retryAt,
                type: rateInfo.type!,
                retryCount,
              });

              // 通知用户
              const typeLabel = rateLimitTypeLabel(rateInfo.type!);
              const timeStr = formatTimeHHMM(rateInfo.retryAt);
              const remaining = formatDuration(rateInfo.retryAt.getTime() - Date.now());
              const statusMsg = `⏳ 检测到${typeLabel}，将在 ${timeStr}（${remaining}后）自动恢复 (${retryCount}/${apConfig.maxRetries})`;
              log.info(`[Autopilot] ${statusMsg} for user ${ctx.userId}`);

              try {
                await platformAdapter.sendError(
                  hadSessionInvalid
                    ? '当前 Claude 会话已失效，已自动执行 /new 重置会话，请重新发送刚才的问题。'
                    : `${error}\n\n${statusMsg}`
                );
              } catch (err) {
                log.error('Failed to send autopilot status:', err);
              }

              cleanup();
              resolve();

              // 异步等待 → 恢复（不阻塞 Promise 解决）
              const retryAt = rateInfo.retryAt;
              const delayMs = Math.max(retryAt.getTime() - Date.now(), 0);
              log.info(`[Autopilot] Scheduling retry in ${delayMs}ms for user ${ctx.userId}`);

              // 分段定时器（setTimeout 最大 ~24.8 天）
              const MAX_SEGMENT = 2_147_483_647; // 2^31 - 1
              const scheduleRetry = (remaining: number) => {
                if (remaining <= 0) {
                  // 定时器到期 → 清除状态 → 发送恢复消息
                  pendingAutopilotTimers.delete(ctx.userId);
                  log.info(`[Autopilot] Timer fired for user ${ctx.userId}, sending "${apConfig.autoResumePrompt}"`);
                  try {
                    platformAdapter.streamUpdate('', `🔄 限额已恢复，正在自动重试... (${retryCount})`);
                  } catch {
                    /* ignore */
                  }
                  deps.autopilot!.onAutoPilotContinue(apConfig.autoResumePrompt);
                  return;
                }
                const segment = Math.min(remaining, MAX_SEGMENT);
                const timer = setTimeout(() => scheduleRetry(remaining - segment), segment);
                if (typeof timer === 'object' && 'unref' in timer) timer.unref();

                // 如果任务被 abort（/new、cancelUser），取消待执行的定时器
                if (ctx.signal) {
                  if (ctx.signal.aborted) {
                    clearTimeout(timer);
                    pendingAutopilotTimers.delete(ctx.userId);
                    return;
                  }
                  ctx.signal.addEventListener('abort', () => {
                    clearTimeout(timer);
                    pendingAutopilotTimers.delete(ctx.userId);
                    log.info(`[Autopilot] Timer cancelled by abort for user ${ctx.userId}`);
                  }, { once: true });
                }
              };
              scheduleRetry(delayMs);
              return;
            }
          }

          // ── 非限流错误或 autopilot 未启用/耗尽重试 ──
          autopilotRetryCount.delete(ctx.userId);

          if (isUsageLimitError(error)) {
            // Usage limit errors: keep session for all tools (user can retry later)
            log.warn(`Keeping ${aiCommand} session for user ${ctx.userId} after usage limit error`);
          } else if (aiCommand !== 'claude') {
            // Non-CLI errors for codex/codebuddy: reset session to avoid stale state
            if (ctx.convId) sessionManager.clearSessionForConv(ctx.userId, ctx.convId, aiCommand);
            else sessionManager.clearActiveToolSession(ctx.userId, aiCommand);
            log.warn(`Session reset for user ${ctx.userId} due to ${aiCommand} task error`);
          }

          const friendlyError = hadSessionInvalid
            ? '当前 Claude 会话已失效，已自动执行 /new 重置会话，请重新发送刚才的问题。'
            : error;
          try {
            await platformAdapter.sendError(friendlyError);
          } catch (err) {
            log.error('Failed to send error:', err);
          }
          cleanup();
          resolve();
        },
        },
        buildRunOptions(config, sessionManager, ctx, aiCommand, toolAdapter)
      );
      return activeHandle;
    };

    taskState = {
      handle: {
        abort: () => {
          if (!settled) {
            // 用户取消（/new、/resume、队列超时、stale 清理）：把「思考中…」占位卡片编辑为终态，
            // 避免卡片卡在转圈。停按钮路径会先 settle() 再 abort，settled=true 时此处跳过，不会双发。
            void platformAdapter.sendError('⏹️ 已取消').catch(() => {
              /* 占位卡片可能已被删除或流过期，编辑失败可忽略 */
            });
          }
          activeHandle?.abort();
          cleanup();
          settle();
        },
      },
      latestContent: '',
      settle,
      startedAt: Date.now(),
      toolId: aiCommand,
      taskKey: ctx.taskKey,
      platform: ctx.platform,
      userKey: ctx.userId,
    };
    try {
      startRun();
    } catch (err) {
      if (!settled) {
        settled = true;
        cleanup();
        log.error(`[AITask] Synchronous error in startRun: ${err}`);
        captureError(err instanceof Error ? err : new Error(String(err)), {
          platform: ctx.platform,
          userId: ctx.userId,
          aiCommand,
        });
        platformAdapter
          .sendError(`内部错误：${err instanceof Error ? err.message : String(err)}`)
          .catch(() => {
            /* ignore */
          });
        resolve();
      }
      return;
    }
    platformAdapter.onTaskReady(taskState);

    // Wire queue abort signal to the running task's abort handle
    if (ctx.signal) {
      if (ctx.signal.aborted) {
        taskState.handle.abort();
      } else {
        ctx.signal.addEventListener('abort', () => taskState.handle.abort(), { once: true });
      }
    }
  });
}
