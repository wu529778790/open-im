/**
 * Claude SDK Adapter - 使用 Agent SDK query() API 实现多轮对话
 *
 * query() API:
 * - 返回 AsyncGenerator<SDKMessage>，直接迭代即可
 * - 支持 resume/cwd/model 等 options，无需 process.chdir hack
 * - SDK 内部管理 session 生命周期，无需手动维护 session pool
 */

import { query, listSessions, getSessionMessages, deleteSession, renameSession, forkSession } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage, SDKSessionInfo, SessionMessage, ModelInfo, SDKControlGetContextUsageResponse, AccountInfo } from '@anthropic-ai/claude-agent-sdk';
import { existsSync, readFileSync, statSync, openSync, readSync, closeSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import { createLogger } from '../logger.js';
import { refreshClaudeEnvToProcess } from '../config/file-io.js';
import { toReplyPlainText } from '../shared/utils.js';
import type { ToolAdapter, RunCallbacks, RunOptions, RunHandle } from './tool-adapter.interface.js';

const log = createLogger('ClaudeSDK');

/**
 * 注入交互式上下文指令，让 Claude 认为这是交互式终端会话。
 * 解决 query() 非交互环境下 Claude 跳过用户选择、直接自主决策的问题。
 */
const INTERACTIVE_CONTEXT = `[SYSTEM: You are in an interactive chat session via instant messenger. The user CAN and WILL respond to your messages — treat this like an interactive terminal session. Rules:
1. When you need to make a decision involving user preference (choosing an approach, selecting between options, deciding what to do next), ALWAYS present clearly numbered options and WAIT for the user's response.
2. Do NOT proceed autonomously when user input would be valuable.
3. Only proceed autonomously for obvious single-path tasks (e.g. reading a file, running a simple command).
4. When presenting options, format them as a numbered list and end with a question.
]
`;

// ── 从 ~/.claude/settings.json 读取用户插件配置 ──

interface UserPluginSettings {
  enabledPlugins?: Record<string, boolean>;
  extraKnownMarketplaces?: Record<string, unknown>;
}

function loadUserPluginSettings(): UserPluginSettings | null {
  try {
    const settingsPath = join(homedir(), '.claude', 'settings.json');
    if (!existsSync(settingsPath)) return null;
    const content = readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(content);
    const result: UserPluginSettings = {};
    if (settings.enabledPlugins) result.enabledPlugins = settings.enabledPlugins;
    if (settings.extraKnownMarketplaces) result.extraKnownMarketplaces = settings.extraKnownMarketplaces;
    if (Object.keys(result).length === 0) return null;
    const pluginNames = Object.keys(result.enabledPlugins ?? {});
    if (pluginNames.length > 0) {
      log.info(`Loaded user plugin settings:\n${pluginNames.map((p) => `  • ${p}`).join("\n")}`);
    } else {
      log.info("Loaded user plugin settings (no enabledPlugins entries in ~/.claude/settings.json)");
    }
    return result;
  } catch (err) {
    log.warn('Failed to read ~/.claude/settings.json for plugin config:', err);
    return null;
  }
}

// Pre-load user plugin settings to cache Claude Code user preferences
loadUserPluginSettings();

// ── 扫描 Claude Code CLI 的最新 session，支持手机/电脑无缝切换 ──

/**
 * 将 workDir（如 /Users/mac/github/open-im）转换为 Claude Code 的项目路径编码
 * ~/.claude/projects/-Users-mac-github-open-im/
 */
function workDirToProjectPath(workDir: string): string {
  return workDir.replace(/\//g, '-');
}

/**
 * 检查 CLI 进程是否**正在活跃使用**某个 session。
 *
 * 仅当同时满足以下两个条件时返回 true：
 *   1. 存在包含该 sessionId 的 claude 进程（通过 ps 检测）
 *   2. session 文件在最近 30 秒内被修改过（说明 CLI 正在处理消息）
 *
 * 如果 CLI 只是挂在终端等待用户输入，进程仍在但文件长时间未变，
 * 此时安全允许 open-im 接管 session（无缝切换）。
 *
 * 注意：仅支持 macOS/Linux，Windows 上会静默返回 false
 */
function isCliSessionActive(sessionId: string, sessionFilePath?: string): boolean {
  try {
    const result = execSync(
      `ps -axo pid,command 2>/dev/null | grep -v grep | grep "claude" | grep -v "claude-agent-sdk" | grep -F -- "${sessionId}" || true`,
      { encoding: 'utf-8', timeout: 3000 }
    );
    if (result.trim().length === 0) return false;

    if (sessionFilePath) {
      try {
        const stat = statSync(sessionFilePath);
        const ageMs = Date.now() - stat.mtimeMs;
        if (ageMs > 30_000) {
          log.info(`CLI process found for ${sessionId} but session file idle for ${Math.round(ageMs / 1000)}s, treating as inactive`);
          return false;
        }
      } catch {
        // stat 失败时保守地认为活跃
      }
    }

    return true;
  } catch {
    return false;
  }
}

interface ClaudeSessionMeta {
  sessionId: string;
  mtime: number;
  filePath: string;
  size: number;
}

/**
 * Find the latest CLI session for a work directory using the SDK's listSessions.
 */
export async function findLatestClaudeSession(workDir: string): Promise<ClaudeSessionMeta | undefined> {
  try {
    const sessions = await listSessions({ dir: workDir, limit: 1 });
    if (sessions.length === 0) {
      log.info(`No sessions found for ${workDir}`);
      return undefined;
    }
    const latest = sessions[0];
    const projectDir = join(homedir(), '.claude', 'projects', workDirToProjectPath(workDir));
    const filePath = join(projectDir, `${latest.sessionId}.jsonl`);
    log.info(`Found latest session via SDK: ${latest.sessionId} (lastModified: ${new Date(latest.lastModified).toISOString()})`);
    return {
      sessionId: latest.sessionId,
      mtime: latest.lastModified,
      filePath,
      size: latest.fileSize ?? 0,
    };
  } catch (err) {
    log.warn(`Failed to list sessions via SDK: ${err}`);
    return undefined;
  }
}

/**
 * 从 JSONL 文件的第一行提取 sessionId，验证文件内容与文件名一致。
 * 只读取前 4KB，避免大文件全量读入内存。
 */
function validateSessionFile(filePath: string, expectedSessionId: string): boolean {
  let fd: number | undefined;
  try {
    fd = openSync(filePath, 'r');
    const buf = Buffer.alloc(4096);
    const bytesRead = readSync(fd, buf, 0, 4096, 0);
    if (bytesRead === 0) return false;
    const firstLine = buf.toString('utf-8', 0, bytesRead).split('\n')[0];
    if (!firstLine) return false;
    const firstEntry = JSON.parse(firstLine);
    return firstEntry.sessionId === expectedSessionId;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* ignore */ }
    }
  }
}

function isStreamEvent(msg: SDKMessage): boolean {
  return (msg as { type?: string }).type === 'stream_event';
}

function isSystemInit(msg: SDKMessage): boolean {
  const m = msg as { type?: string; subtype?: string };
  return m.type === 'system' && m.subtype === 'init';
}

function isAssistant(msg: SDKMessage): boolean {
  return (msg as { type?: string }).type === 'assistant';
}

function isResult(msg: SDKMessage): boolean {
  return (msg as { type?: string }).type === 'result';
}

function isSessionCorruptionError(msg: string): boolean {
  return /session\s*(not found|expired|corrupt)|no\s*conversation\s*found/i.test(msg);
}

const MAX_CAPTURED_STDERR_CHARS = 4000;
const MAX_EXPOSED_STDERR_CHARS = 500;

function appendStderrSnippet(previous: string, chunk: string): string {
  const next = previous + chunk;
  if (next.length <= MAX_CAPTURED_STDERR_CHARS) return next;
  return next.slice(-MAX_CAPTURED_STDERR_CHARS);
}

function getUsefulStderrSnippet(stderr: string): string | undefined {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return undefined;
  const summary = lines.slice(-3).join(' | ');
  return summary.length <= MAX_EXPOSED_STDERR_CHARS
    ? summary
    : summary.slice(0, MAX_EXPOSED_STDERR_CHARS - 3) + '...';
}

function enrichClaudeErrorMessage(message: string, stderr: string): string {
  const snippet = getUsefulStderrSnippet(stderr);
  if (!snippet) return message;
  if (message.includes(snippet)) return message;
  if (/process exited with code \d+/i.test(message) || /无输出/.test(message) || /未知错误/.test(message)) {
    return `${message} stderr: ${snippet}`;
  }
  return message;
}

export class ClaudeSDKAdapter implements ToolAdapter {
  readonly toolId = 'claude-sdk';
  readonly interactionMode = 'native';

  /**
   * 清理所有活跃的查询
   */
  static destroy(): void {
    // query() API 的 Query 对象通过 abortController.abort() 清理
  }

  /**
   * List sessions for a directory using the SDK's listSessions API.
   */
  static async listSessionsForDir(workDir: string, limit = 20): Promise<SDKSessionInfo[]> {
    try {
      return await listSessions({ dir: workDir, limit });
    } catch (err) {
      log.warn(`Failed to list sessions for ${workDir}: ${err}`);
      return [];
    }
  }

  /**
   * Get session messages for a given session ID.
   */
  static async getSessionMessagesForId(sessionId: string, workDir: string, limit = 50): Promise<SessionMessage[]> {
    try {
      return await getSessionMessages(sessionId, { dir: workDir, limit });
    } catch (err) {
      log.warn(`Failed to get session messages for ${sessionId}: ${err}`);
      return [];
    }
  }

  /**
   * Delete a session by ID.
   */
  static async deleteSessionById(sessionId: string, workDir?: string): Promise<boolean> {
    try {
      await deleteSession(sessionId, { dir: workDir });
      return true;
    } catch (err) {
      log.warn(`Failed to delete session ${sessionId}: ${err}`);
      return false;
    }
  }

  /**
   * Rename a session.
   */
  static async renameSessionById(sessionId: string, title: string, workDir?: string): Promise<boolean> {
    try {
      await renameSession(sessionId, title, { dir: workDir });
      return true;
    } catch (err) {
      log.warn(`Failed to rename session ${sessionId}: ${err}`);
      return false;
    }
  }

  /**
   * Fork a session.
   */
  static async forkSessionById(sessionId: string, workDir?: string): Promise<string | undefined> {
    try {
      const result = await forkSession(sessionId, { dir: workDir });
      return result.sessionId;
    } catch (err) {
      log.warn(`Failed to fork session ${sessionId}: ${err}`);
      return undefined;
    }
  }

  /**
   * Create a short-lived query for fetching session info (models, context, etc).
   * The caller must close the returned query when done.
   */
  static async createInfoQuery(workDir: string, model?: string): Promise<ReturnType<typeof query>> {
    const resolvedModel = model?.trim() || process.env.ANTHROPIC_MODEL?.trim() || 'claude-opus-4-5';
    return query({
      prompt: '',
      options: {
        cwd: workDir,
        model: resolvedModel,
        permissionMode: 'default' as const,
      },
    });
  }

  /**
   * Get available models for a work directory.
   */
  static async getSupportedModels(workDir: string, model?: string): Promise<ModelInfo[]> {
    let q: Awaited<ReturnType<typeof this.createInfoQuery>> | undefined;
    try {
      q = await this.createInfoQuery(workDir, model);
      return await q.supportedModels();
    } catch (err) {
      log.warn(`Failed to get supported models: ${err}`);
      return [];
    } finally {
      if (q) { try { await q.return(undefined); } catch { /* ignore */ } }
    }
  }

  /**
   * Get context usage for a work directory.
   */
  static async getContextUsage(workDir: string, model?: string): Promise<SDKControlGetContextUsageResponse | undefined> {
    let q: Awaited<ReturnType<typeof this.createInfoQuery>> | undefined;
    try {
      q = await this.createInfoQuery(workDir, model);
      return await q.getContextUsage();
    } catch (err) {
      log.warn(`Failed to get context usage: ${err}`);
      return undefined;
    } finally {
      if (q) { try { await q.return(undefined); } catch { /* ignore */ } }
    }
  }

  /**
   * Get account info for a work directory.
   */
  static async getAccountInfo(workDir: string, model?: string): Promise<AccountInfo | undefined> {
    let q: Awaited<ReturnType<typeof this.createInfoQuery>> | undefined;
    try {
      q = await this.createInfoQuery(workDir, model);
      return await q.accountInfo();
    } catch (err) {
      log.warn(`Failed to get account info: ${err}`);
      return undefined;
    } finally {
      if (q) { try { await q.return(undefined); } catch { /* ignore */ } }
    }
  }

  run(
    prompt: string,
    sessionId: string | undefined,
    workDir: string,
    callbacks: RunCallbacks,
    options?: RunOptions
  ): RunHandle {
    // 刷新 Claude 环境变量（支持 cc switch 后无需重启即可生效）
    refreshClaudeEnvToProcess();

    const abortController = new AbortController();
    let runSettled = false;
    let recentStderr = '';

    const permissionMode = options?.skipPermissions
      ? ('bypassPermissions' as const)
      : options?.permissionMode === 'acceptEdits'
        ? ('acceptEdits' as const)
        : options?.permissionMode === 'plan'
          ? ('plan' as const)
          : ('default' as const);

    const resolvedModel = options?.model?.trim() || process.env.ANTHROPIC_MODEL?.trim() || 'claude-opus-4-5';
    const baseUrl = process.env.ANTHROPIC_BASE_URL ?? '(default)';
    log.info(`[query] run() entry model=${resolvedModel} baseUrl=${baseUrl} sessionId=${sessionId ?? 'new'} workDir=${workDir}`);

    const runQuery = async () => {
      let accumulated = '';
      let accumulatedThinking = '';
      const toolStats: Record<string, number> = {};
      let actualSessionId: string | undefined;
      let hadSessionInvalid = false;

      try {
        // 先尝试自动恢复 CLI 的最新 session（如果用户没有指定 sessionId，且不是 /new 后的新 session）
        let resumeId = sessionId;
        if (!resumeId && !options?.skipAutoResume) {
          const latest = await findLatestClaudeSession(workDir);
          if (latest) {
            const cliActive = isCliSessionActive(latest.sessionId, latest.filePath);
            if (cliActive) {
              log.info(`CLI is actively using session ${latest.sessionId}, attempting resume anyway`);
            }
            if (validateSessionFile(latest.filePath, latest.sessionId)) {
              resumeId = latest.sessionId;
              log.info(`Auto-resuming latest CLI session: ${latest.sessionId}${cliActive ? ' (CLI active)' : ''}`);
            } else {
              log.warn(`Session file validation failed for ${latest.sessionId}, skipping`);
            }
          }
        }

        const q = query({
          prompt: INTERACTIVE_CONTEXT + prompt,
          options: {
            cwd: workDir,
            model: resolvedModel,
            permissionMode,
            // 启用完整工具集，与 cc 终端一致
            tools: { type: 'preset', preset: 'claude_code' },
            // 启用所有技能（superpowers, playwright 等），与 cc 终端一致
            skills: 'all',
            ...(resumeId ? { resume: resumeId } : {}),
            ...(options?.fallbackModel ? { fallbackModel: options.fallbackModel } : {}),
            ...(options?.disallowedTools?.length ? { disallowedTools: options.disallowedTools } : {}),
            abortController,
            stderr: (data: string) => {
              recentStderr = appendStderrSnippet(recentStderr, data);
            },
          },
        });

        try {
          for await (const msg of q) {
            if (abortController.signal.aborted) {
              log.info('Query aborted by user');
              break;
            }

            // 获取实际的 sessionId（从 init 消息中）
            if (isSystemInit(msg)) {
              const initMsg = msg as {
                session_id?: string;
                skills?: string[];
                plugins?: Array<{ name: string; path: string }>;
                tools?: string[];
              };
              const pluginNames = initMsg.plugins?.map(p => p.name).join(', ') ?? 'none';
              const skillCount = initMsg.skills?.length ?? 0;
              const toolCount = initMsg.tools?.length ?? 0;
              log.info(`[query] Init: plugins=[${pluginNames}], skills=${skillCount}, tools=${toolCount}`);

              if (initMsg.session_id) {
                actualSessionId = initMsg.session_id;
                log.info(`[query] Got sessionId: ${actualSessionId}`);
                callbacks.onSessionId?.(actualSessionId);
              }
              continue;
            }

            // 处理流式事件
            if (isStreamEvent(msg)) {
              const ev = (msg as { event?: { type?: string; delta?: { type?: string; text?: string; thinking?: string } } }).event;
              if (ev?.type === 'content_block_delta' && ev.delta) {
                if (ev.delta.type === 'text_delta' && ev.delta.text) {
                  accumulated += ev.delta.text;
                  callbacks.onText(accumulated);
                } else if (ev.delta.type === 'thinking_delta' && ev.delta.thinking) {
                  accumulatedThinking += ev.delta.thinking;
                  callbacks.onThinking?.(accumulatedThinking);
                }
              }
              continue;
            }

            // 处理助手消息（工具调用）
            if (isAssistant(msg)) {
              const content = (msg as { message?: { content?: Array<{ type?: string; name?: string; input?: unknown }> } }).message?.content;
              for (const block of content ?? []) {
                if (block?.type === 'tool_use' && block.name) {
                  toolStats[block.name] = (toolStats[block.name] || 0) + 1;
                  callbacks.onToolUse?.(block.name, block.input as Record<string, unknown>);
                }
              }
              continue;
            }

            // 处理结果消息
            if (isResult(msg)) {
              const m = msg as {
                subtype?: string;
                result?: unknown;
                total_cost_usd?: number;
                duration_ms?: number;
                num_turns?: number;
                errors?: string[];
                session_id?: string;
              };
              const success = m.subtype === 'success';
              const errs = m.errors ?? [];

              // 更新 sessionId（如果 init 消息中没有）
              if (m.session_id && !actualSessionId) {
                actualSessionId = m.session_id;
                callbacks.onSessionId?.(actualSessionId);
              }

              log.info(`[query] Result: subtype=${m.subtype}, num_turns=${m.num_turns}, sessionId=${actualSessionId ?? 'unknown'}`);

              if (!success) {
                runSettled = true;

                const noConvErr = errs.find((e) => e.includes('No conversation found') || e.includes('session not found'));
                if (noConvErr) {
                  log.warn(`Session ${actualSessionId} not found`);
                  hadSessionInvalid = true;
                  callbacks.onSessionInvalid?.();
                }
                const errMsg = enrichClaudeErrorMessage(errs[0] || '未知错误', recentStderr);
                callbacks.onError(errMsg);
                return;
              }

              const resultText = toReplyPlainText(m.result ?? '');
              const result: Parameters<RunCallbacks['onComplete']>[0] = {
                success,
                result: resultText,
                accumulated: success ? accumulated : '',
                cost: m.total_cost_usd ?? 0,
                durationMs: m.duration_ms ?? 0,
                numTurns: m.num_turns ?? 0,
                toolStats,
              };

              if (!result.accumulated && result.result) {
                result.accumulated = result.result;
              }
              if (!result.accumulated && !result.result && accumulated) {
                result.accumulated = accumulated;
                result.result = accumulated;
              }

              runSettled = true;
              callbacks.onComplete(result);
              return;
            }
          }

          // 如果流正常结束但没有收到 result 消息
          if (!runSettled) {
            if (accumulated) {
              log.info('Stream ended without result message, using accumulated text');
              runSettled = true;
              callbacks.onComplete({
                success: true,
                result: accumulated,
                accumulated,
                cost: 0,
                durationMs: 0,
                numTurns: 1,
                toolStats,
              });
            } else {
              log.warn('Stream ended with no result and no accumulated text, calling onError to prevent stuck state');
              runSettled = true;
              callbacks.onError(enrichClaudeErrorMessage('AI 响应异常结束（无输出），请重试', recentStderr));
            }
          }
        } finally {
          // Query 的 cleanup 由 SDK 内部管理
        }
      } catch (err) {
        if (abortController.signal.aborted) {
          log.info('Query run aborted');
          return;
        }

        runSettled = true;
        const errorObj = err as Error;
        const msg = enrichClaudeErrorMessage(errorObj.message || String(err), recentStderr);

        log.error(`Claude SDK error: ${msg}`);
        if (errorObj.stack) {
          log.error(`Error stack: ${errorObj.stack}`);
        }

        if (isSessionCorruptionError(msg)) {
          log.warn(`Session corruption detected: ${msg}`);
          callbacks.onSessionInvalid?.();
        }

        callbacks.onError(msg);
      }
    };

    // 启动查询（不等待），catch 兜底防止 unhandledRejection
    runQuery().catch((err) => {
      if (!runSettled) {
        runSettled = true;
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`Unhandled runQuery error: ${msg}`);
        callbacks.onError(msg);
      }
    });

    return {
      abort: () => {
        log.info('Aborting query');
        abortController.abort();
      },
    };
  }
}
