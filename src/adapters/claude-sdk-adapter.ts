/**
 * Claude SDK Adapter - 使用 Agent SDK V2 Session API 实现真正的多轮对话
 *
 * V2 API 优势：
 * 1. 进程内执行 - 无 fork/exec 开销
 * 2. 持久会话 - SDKSession 对象保持会话状态，支持真正的多轮对话
 * 3. 流式输出 - 支持实时增量更新
 *
 * 认证：ANTHROPIC_API_KEY 或 CLAUDE_CODE_OAUTH_TOKEN
 */

import { unstable_v2_createSession, unstable_v2_resumeSession, listSessions } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage, SDKSession, SDKSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import { existsSync, readFileSync, statSync, openSync, readSync, closeSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import { createLogger } from '../logger.js';
import { refreshClaudeEnvToProcess } from '../config/file-io.js';
import { toReplyPlainText } from '../shared/utils.js';
import type { ToolAdapter, RunCallbacks, RunOptions, RunHandle } from './tool-adapter.interface.js';

const log = createLogger('ClaudeSDK');

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
  // Claude Code 将路径中的 / 替换为 -，leading - 保留
  // /Users/mac/github/open-im → -Users-mac-github-open-im
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
    // macOS/Linux: 用 ps 搜索包含该 sessionId 的 claude 进程
    // 排除 open-im 自己的 SDK 子进程（路径含 claude-agent-sdk），只匹配用户交互式 CLI
    // -F 固定字符串匹配，避免正则意外；-- 防止 sessionId 被误认为 flag
    const result = execSync(
      `ps -axo pid,command 2>/dev/null | grep -v grep | grep "claude" | grep -v "claude-agent-sdk" | grep -F -- "${sessionId}" || true`,
      { encoding: 'utf-8', timeout: 3000 }
    );
    if (result.trim().length === 0) return false;

    // 进程存在，但可能只是 idle 在终端等输入。检查文件 mtime：
    // 如果 session 文件超过 30 秒未修改，说明 CLI 没在活跃处理。
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
 * Falls back to undefined if no sessions found.
 */
export async function findLatestClaudeSession(workDir: string): Promise<ClaudeSessionMeta | undefined> {
  try {
    const sessions = await listSessions({ dir: workDir, limit: 1 });
    if (sessions.length === 0) {
      log.info(`No sessions found for ${workDir}`);
      return undefined;
    }
    const latest = sessions[0];
    // filePath is needed for isCliSessionActive check — derive from standard path
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

// 存储所有活跃的 SDKSession 对象，key 为 sessionId
// 使用 Map 而不是 Set，因为我们需要通过 sessionId 获取 session
const activeSessions = new Map<string, SDKSession>();

// 记录每个 session 创建/恢复时的 workDir，防止跨 workDir 复用已固定 cwd 的子进程
const sessionWorkDirs = new Map<string, string>();

// 存储正在进行的流式迭代器，用于中断
const activeStreams = new Set<AsyncIterator<SDKMessage>>();

// 空闲会话清理：跟踪最后使用时间，定期清除超时会话
const sessionLastUsed = new Map<string, number>();
// 跟踪正在执行任务的 session ID，防止空闲清理误杀运行中的长任务
const runningSessions = new Set<string>();
let sessionIdleTtlMs = 30 * 60 * 1000; // 默认 30 分钟未使用则清理
let sessionIdleCleanupDisabled = false;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 每 5 分钟检查一次
const MAX_ACTIVE_SESSIONS = 100;
const MAX_CAPTURED_STDERR_CHARS = 4000;
const MAX_EXPOSED_STDERR_CHARS = 500;

let sessionSeq = 0;

/**
 * 由 initAdapters 根据配置调用。ttlMinutes≤0 时关闭空闲回收（仍受 MAX_ACTIVE_SESSIONS 限制）。
 */
export function configureClaudeSdkSessionIdle(ttlMinutes: number): void {
  if (ttlMinutes <= 0) {
    sessionIdleCleanupDisabled = true;
    log.info('Claude SDK: idle session cleanup disabled (sessionIdleTtlMinutes=0)');
  } else {
    sessionIdleCleanupDisabled = false;
    sessionIdleTtlMs = ttlMinutes * 60 * 1000;
  }
}

const cleanupInterval = setInterval(() => {
  if (sessionIdleCleanupDisabled) return;
  const now = Date.now();
  for (const [id, lastUsed] of sessionLastUsed) {
    if (runningSessions.has(id)) continue; // 跳过正在运行任务的 session
    if (now - lastUsed > sessionIdleTtlMs) {
      const session = activeSessions.get(id);
      if (session) {
        try { session.close(); } catch { /* ignore */ }
        activeSessions.delete(id);
      }
      sessionLastUsed.delete(id);
      sessionWorkDirs.delete(id);
      log.info(`Cleaned up idle session (unused ${Math.round((now - lastUsed) / 60000)}min): ${id}`);
    }
  }
}, CLEANUP_INTERVAL_MS);
cleanupInterval.unref(); // 不阻止进程退出

/**
 * 串行化进程级 process.chdir() —— 同一时刻仅一个 chdir 生效。
 *
 * SDK V2 的 createSession/resumeSession 不接受 cwd 参数；且 send()/stream()
 * 会以「调用时的 process.cwd()」派生 Claude Code 子进程。必须用互斥锁串行化
 * 「整个 turn 的 cwd 切换」，否则并发多用户会让工具跑错目录。
 *
 * **TODO:** SDK 支持 cwd 选项后移除此锁。upstream:
 * https://github.com/anthropics/claude-agent-sdk/issues
 */
let chdirMutex: Promise<void> = Promise.resolve();
function withChdirMutex<T>(fn: () => T | Promise<T>): Promise<T> {
  const previous = chdirMutex;
  let release!: () => void;
  chdirMutex = new Promise<void>((r) => { release = r; });
  return previous.then(async () => {
    try {
      return await fn();
    } finally {
      release();
    }
  });
}

/**
 * 在持有全局 chdir 互斥锁期间，把进程 cwd 切到 workDir 执行 fn，结束后恢复。
 * 用于包裹 session.send()+stream()，确保子进程在正确 workDir 派生。
 */
function runWithWorkDir<T>(workDir: string, fn: () => Promise<T>): Promise<T> {
  return withChdirMutex(async () => {
    const originalCwd = process.cwd();
    if (workDir && workDir !== originalCwd) {
      process.chdir(workDir);
    }
    try {
      return await fn();
    } finally {
      if (workDir && workDir !== originalCwd) {
        process.chdir(originalCwd);
      }
    }
  });
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

/**
 * 获取或创建 SDKSession
 * @param sessionId 已有的 sessionId，如果为 undefined 则创建新会话
 * @param workDir 工作目录
 * @param model 模型名称
 * @param permissionMode 权限模式
 * @returns SDKSession 对象和实际的 sessionId
 */
async function getOrCreateSession(
  sessionId: string | undefined,
  workDir: string,
  model: string | undefined,
  permissionMode: 'default' | 'bypassPermissions' | 'acceptEdits' | 'plan',
  onStderr?: (data: string) => void,
): Promise<{ session: SDKSession; sessionId: string }> {
  // 刷新 Claude 环境变量（支持 cc switch 后无需重启即可生效）
  refreshClaudeEnvToProcess();

  const resolvedModel = model?.trim() || process.env.ANTHROPIC_MODEL?.trim() || 'claude-opus-4-5';

  if (activeSessions.size >= MAX_ACTIVE_SESSIONS) {
    throw new Error(`Session pool is full (${MAX_ACTIVE_SESSIONS}). Cannot create new session.`);
  }
  const sessionOptions = {
    model: resolvedModel,
    permissionMode,
    stderr: onStderr,
  };

  const baseUrl = process.env.ANTHROPIC_BASE_URL ?? '(default)';
  log.info(`[V2] getOrCreateSession model param=${String(model ?? '')} resolved=${resolvedModel} baseUrl=${baseUrl} workDir=${workDir}`);

  // NOTE: process.chdir() 是进程级全局副作用，在并发服务器中不理想。
  // 但 SDK 的 createSession/resumeSession 不接受 cwd 参数，且这些调用是同步的，
  // 所以 mutex + try/finally 已是最优方案。如果 SDK 未来支持 cwd 选项，应移除 chdir。
  return withChdirMutex(async () => {
    let session: SDKSession;

    const originalCwd = process.cwd();
    try {
      if (workDir && workDir !== originalCwd) {
        process.chdir(workDir);
      }

      if (sessionId) {
        // 优先复用内存中已有的 SDKSession，避免每次都启动新进程。
        // 仅当 workDir 与创建时一致才复用：否则子进程 cwd 已固定在旧目录，
        // 需走 resume 重新派生（在当前 workDir 启动新子进程）。
        const existing = activeSessions.get(sessionId);
        if (existing && sessionWorkDirs.get(sessionId) === workDir) {
          log.info(`Reusing existing in-memory session: ${sessionId}`);
          sessionLastUsed.set(sessionId, Date.now());
          return { session: existing, sessionId };
        }

        // 内存中没有（或 workDir 变了），尝试通过 resume 恢复（会启动新 CLI 进程）
        try {
          log.info(`Attempting to resume session: ${sessionId}`);
          session = unstable_v2_resumeSession(sessionId, sessionOptions);
          activeSessions.set(sessionId, session);
          sessionWorkDirs.set(sessionId, workDir);
          sessionLastUsed.set(sessionId, Date.now());
          log.info(`Successfully resumed session: ${sessionId}`);
          return { session, sessionId };
        } catch (err) {
          log.warn(`Failed to resume session ${sessionId}, creating new one: ${err}`);
          // 恢复失败，创建新会话
        }
      }

      // 没有指定 sessionId 时，尝试自动恢复 Claude Code CLI 的最新 session
      // 实现手机/电脑无缝切换：同目录下默认共享同一个对话
      if (!sessionId) {
        const latest = await findLatestClaudeSession(workDir);
        if (latest) {
          // 检测 CLI 是否正在使用该 session（用于日志，不阻止 resume）
          const cliActive = isCliSessionActive(latest.sessionId, latest.filePath);
          if (cliActive) {
            log.info(`CLI is actively using session ${latest.sessionId}, attempting resume anyway (SDK handles concurrency)`);
          }

          // 验证文件内容一致性
          if (validateSessionFile(latest.filePath, latest.sessionId)) {
            try {
              log.info(`Auto-resuming latest CLI session: ${latest.sessionId}${cliActive ? ' (CLI active)' : ''}`);
              session = unstable_v2_resumeSession(latest.sessionId, sessionOptions);
              activeSessions.set(latest.sessionId, session);
              sessionWorkDirs.set(latest.sessionId, workDir);
              sessionLastUsed.set(latest.sessionId, Date.now());
              log.info(`Successfully auto-resumed CLI session: ${latest.sessionId}`);
              return { session, sessionId: latest.sessionId };
            } catch (err) {
              log.warn(`Failed to auto-resume CLI session ${latest.sessionId}, creating new one: ${err}`);
            }
          } else {
            log.warn(`Session file validation failed for ${latest.sessionId}, skipping`);
          }
        }
      }

      // 创建新会话
      session = unstable_v2_createSession(sessionOptions);
      // 新会话的 sessionId 需要从第一个消息中获取
      // 暂时返回 undefined，稍后在 init 消息中获取
      const tempId = `pending-${++sessionSeq}`;
      activeSessions.set(tempId, session);
      sessionWorkDirs.set(tempId, workDir);
      sessionLastUsed.set(tempId, Date.now());
      log.info(`Created new session (tempId: ${tempId})`);
      return { session, sessionId: tempId, wasReused: false };
    } finally {
      if (workDir && workDir !== originalCwd) {
        process.chdir(originalCwd);
      }
    }
  });
}

export class ClaudeSDKAdapter implements ToolAdapter {
  readonly toolId = 'claude-sdk';

  /**
   * 清理所有活跃的 SDK 会话和流
   */
  static destroy(): void {
    clearInterval(cleanupInterval);

    for (const stream of activeStreams) {
      try {
        if (stream && typeof stream.return === 'function') {
          stream.return();
        }
      } catch {
        /* ignore */
      }
    }
    activeStreams.clear();

    for (const session of activeSessions.values()) {
      try {
        session.close();
      } catch {
        /* ignore */
      }
    }
    activeSessions.clear();
    sessionLastUsed.clear();
    sessionWorkDirs.clear();
  }

  /**
   * Remove a specific session from the in-memory cache and close it.
   * Useful when the caller knows a session is corrupted.
   */
  static removeSession(sessionId: string): void {
    const session = activeSessions.get(sessionId);
    if (session) {
      try { session.close(); } catch { /* ignore */ }
      activeSessions.delete(sessionId);
      sessionLastUsed.delete(sessionId);
      sessionWorkDirs.delete(sessionId);
      log.info(`Explicitly removed session: ${sessionId}`);
    }
  }

  /**
   * List sessions for a directory using the SDK's listSessions API.
   * Replaces the custom file-scanning logic in findLatestClaudeSession.
   */
  static async listSessionsForDir(workDir: string, limit = 20): Promise<SDKSessionInfo[]> {
    try {
      return await listSessions({ dir: workDir, limit });
    } catch (err) {
      log.warn(`Failed to list sessions for ${workDir}: ${err}`);
      return [];
    }
  }

  run(
    prompt: string,
    sessionId: string | undefined,
    workDir: string,
    callbacks: RunCallbacks,
    options?: RunOptions
  ): RunHandle {
    log.info(`[V2] run() entry model=${String(options?.model ?? '')} baseUrl=${process.env.ANTHROPIC_BASE_URL ?? '(default)'}`);

    const abortController = new AbortController();
    let streamClosed = false;
    let actualSessionId: string | undefined;
    let pendingTempId: string | undefined; // 记录临时 ID，用于 abort 时清理
    let runSettled = false;
    let currentStream: AsyncIterator<SDKMessage> | undefined; // 用于 abort 时立即中断 stream
    let recentStderr = '';

    const permissionMode = options?.skipPermissions
      ? ('bypassPermissions' as const)
      : options?.permissionMode === 'acceptEdits'
        ? ('acceptEdits' as const)
        : options?.permissionMode === 'plan'
          ? ('plan' as const)
          : ('default' as const);

    const runSession = async () => {
      let trackedRunningId: string | undefined; // 用于 finally 中清理 runningSessions
      try {
        // 检查环境变量
        const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
        const hasAuthToken = !!process.env.ANTHROPIC_AUTH_TOKEN;

        if (!hasApiKey && !hasAuthToken) {
          log.warn('Claude SDK: No API credentials found in environment variables');
        }

        log.info(`[V2] Session: ${sessionId ?? 'new'}, prompt="${prompt.slice(0, 50)}..."`);
        log.info(`[V2] model param=${String(options?.model ?? '')} baseUrl=${process.env.ANTHROPIC_BASE_URL ?? '(default)'}`);

        // 获取或创建会话
        const { session, sessionId: returnedId } = await getOrCreateSession(
          sessionId,
          workDir,
          options?.model,
          permissionMode,
          (data) => {
            recentStderr = appendStderrSnippet(recentStderr, data);
          },
        );
        if (returnedId.startsWith('pending-')) {
          pendingTempId = returnedId;
        }
        runningSessions.add(returnedId);
        trackedRunningId = returnedId;

        // 在持有 chdir 锁期间完成 send() + stream() 获取：SDK V2 会以当前
        // process.cwd() 派生 Claude Code 子进程，必须保证此刻 cwd 为 workDir。
        // 锁串行化后，并发多用户的子进程不会在错误的目录派生。
        const stream = await runWithWorkDir(workDir, async () => {
          await session.send(prompt);
          const s = session.stream();
          currentStream = s;
          activeStreams.add(s);
          return s;
        });

        let accumulated = '';
        let accumulatedThinking = '';
        const toolStats: Record<string, number> = {};

        try {
          for await (const msg of stream) {
            if (abortController.signal.aborted) {
              log.info('Stream aborted by user');
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
              // 记录 session 加载的插件和技能
              const pluginNames = initMsg.plugins?.map(p => p.name).join(', ') ?? 'none';
              const skillCount = initMsg.skills?.length ?? 0;
              const toolCount = initMsg.tools?.length ?? 0;
              log.info(`[V2] Init: plugins=[${pluginNames}], skills=${skillCount}, tools=${toolCount}`);

              const newSessionId = initMsg.session_id;
              if (newSessionId && newSessionId !== actualSessionId) {
                // 更新 sessionId 映射
                // 清理 pending 临时 ID（actualSessionId 尚未赋值时用 pendingTempId）
                const idToClean = actualSessionId ?? pendingTempId;
                const inheritedWorkDir = idToClean ? sessionWorkDirs.get(idToClean) : undefined;
                if (idToClean?.startsWith('pending-')) {
                  activeSessions.delete(idToClean);
                }
                activeSessions.set(newSessionId, session);
                if (inheritedWorkDir !== undefined) {
                  sessionWorkDirs.set(newSessionId, inheritedWorkDir);
                }
                sessionLastUsed.set(newSessionId, Date.now());
                if (idToClean) {
                  sessionLastUsed.delete(idToClean);
                  sessionWorkDirs.delete(idToClean);
                }
                // 更新 runningSessions：移除旧 ID，添加新 ID
                if (idToClean) runningSessions.delete(idToClean);
                runningSessions.add(newSessionId);
                trackedRunningId = newSessionId;
                actualSessionId = newSessionId;
                log.info(`[V2] Got actual sessionId: ${newSessionId}`);
                callbacks.onSessionId?.(newSessionId);
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
              streamClosed = true;
              const m = msg as {
                subtype?: string;
                result?: unknown;
                total_cost_usd?: number;
                duration_ms?: number;
                num_turns?: number;
                errors?: string[];
              };
              const success = m.subtype === 'success';
              const errs = m.errors ?? [];

              log.info(`[V2] Result: subtype=${m.subtype}, num_turns=${m.num_turns}, sessionId=${actualSessionId ?? 'unknown'}`);

              // 检查会话错误
              if (!success) {
                runSettled = true;

                const noConvErr = errs.find((e) => e.includes('No conversation found') || e.includes('session not found'));
                if (noConvErr) {
                  log.warn(`Session ${actualSessionId} not found, removing from active sessions`);
                  if (actualSessionId) {
                    activeSessions.delete(actualSessionId);
                    sessionLastUsed.delete(actualSessionId);
                    try { session.close(); } catch { /* ignore */ }
                  }
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
          if (!streamClosed) {
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
              // 流结束但无 result 也无 accumulated：必须触发回调，否则 Promise 永远挂起
              log.warn('Stream ended with no result and no accumulated text, calling onError to prevent stuck state');
              runSettled = true;
              callbacks.onError(enrichClaudeErrorMessage('AI 响应异常结束（无输出），请重试', recentStderr));
            }
          }
        } finally {
          // 从活跃列表中移除流
          activeStreams.delete(stream);
        }
      } catch (err) {
        if (abortController.signal.aborted) {
          log.info('Session run aborted');
          // 清理 pending tempId（abort 可能在 init 消息之前发生）
          const idToClean = actualSessionId ?? pendingTempId;
          if (idToClean?.startsWith('pending-')) {
            activeSessions.delete(idToClean);
            log.info(`Cleaned up pending session: ${idToClean}`);
          }
          return;
        }

        runSettled = true;
        const errorObj = err as Error;
        const msg = enrichClaudeErrorMessage(errorObj.message || String(err), recentStderr);

        log.error(`Claude SDK V2 error: ${msg}`);
        if (errorObj.stack) {
          log.error(`Error stack: ${errorObj.stack}`);
        }

        // 清理 pending tempId（session 在获取真实 ID 前就失败了）
        const errIdToClean = actualSessionId ?? pendingTempId;
        if (errIdToClean?.startsWith('pending-')) {
          activeSessions.delete(errIdToClean);
          log.warn(`Cleaned up pending session after error: ${errIdToClean}`);
        }

        // If error suggests a corrupted session, remove it from cache to prevent reuse
        if (actualSessionId && isSessionCorruptionError(msg)) {
          const corrupted = activeSessions.get(actualSessionId);
          activeSessions.delete(actualSessionId);
          sessionLastUsed.delete(actualSessionId);
          if (corrupted) {
            try { corrupted.close(); } catch { /* ignore */ }
          }
          log.warn(`Removed corrupted session ${actualSessionId} after error: ${msg}`);
          callbacks.onSessionInvalid?.();
        }

        callbacks.onError(msg);
      } finally {
        // 无论成功、失败还是 abort，都从运行中集合移除
        if (trackedRunningId) {
          runningSessions.delete(trackedRunningId);
        }
        // 也清理 actualSessionId（可能在 init 后更新了）
        if (actualSessionId && actualSessionId !== trackedRunningId) {
          runningSessions.delete(actualSessionId);
        }
      }
    };

    // 启动会话（不等待），catch 兜底防止 unhandledRejection 导致用户请求挂起
    runSession().catch((err) => {
      if (!runSettled) {
        runSettled = true;
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`Unhandled runSession error: ${msg}`);
        callbacks.onError(msg);
      }
    });

    return {
      abort: () => {
        log.info('Aborting session run');
        abortController.abort();
        // 立即中断 stream，不等下一条消息
        if (currentStream) {
          try { currentStream.return?.(); } catch { /* ignore */ }
        }
      },
    };
  }
}
