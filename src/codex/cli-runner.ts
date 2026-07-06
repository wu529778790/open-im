/**
 * Codex CLI runner for `codex exec --json` JSONL output.
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { createLogger } from '../logger.js';
import { killProcessTree, trackChild } from '../shared/process-kill.js';
import { isSessionInvalidMessage } from '../shared/session-invalid-detector.js';
import {
  createStderrBuffer,
  appendStderr,
  reconstructStderr,
  createFinalizeGate,
  isFinalizeReady,
  clearWallClockTimeout,
  buildBaseSpawnOptions,
} from '../shared/cli-runner-base.js';
import type { RunCallbacks, RunHandle } from '../adapters/tool-adapter.interface.js';

const log = createLogger('CodexCli');
const windowsCodexLaunchCache = new Map<string, { command: string; args: string[] } | null>();
const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.tif',
  '.tiff',
  '.avif',
]);

export interface CodexRunOptions {
  skipPermissions?: boolean;
  permissionMode?: 'default' | 'acceptEdits' | 'plan';
  model?: string;
  chatId?: string;
  hookPort?: number;
  proxy?: string;
}

function parseCodexEvent(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isSupportedImagePath(filePath: string): boolean {
  const normalized = filePath.trim();
  if (!normalized || !existsSync(normalized)) return false;
  const lower = normalized.toLowerCase();
  return Array.from(SUPPORTED_IMAGE_EXTENSIONS).some((ext) => lower.endsWith(ext));
}

export function extractPromptImagePaths(prompt: string): string[] {
  const imagePaths = new Set<string>();
  const lines = prompt.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const singleMatch = /^Saved local file path:\s*(.+)$/i.exec(line);
    if (singleMatch) {
      const candidate = singleMatch[1].trim();
      if (isSupportedImagePath(candidate)) imagePaths.add(candidate);
      continue;
    }

    const batchMatch = /^\d+\.\s+(?:.+:\s+)?(.+?)\s+\((image)\)$/i.exec(line);
    if (batchMatch) {
      const candidate = batchMatch[1].trim();
      if (isSupportedImagePath(candidate)) imagePaths.add(candidate);
    }
  }

  return Array.from(imagePaths);
}

export function buildCodexArgs(
  prompt: string,
  sessionId: string | undefined,
  workDir: string,
  options?: CodexRunOptions,
): string[] {
  const commonOptions = ['--json', '--skip-git-repo-check'];
  const newSessionOptions = [...commonOptions, '--cd', workDir];
  const resumeOptions = [...commonOptions];
  const canResume = Boolean(sessionId) && options?.permissionMode !== 'plan';
  const imagePaths = extractPromptImagePaths(prompt);

  if (options?.skipPermissions) {
    newSessionOptions.push('--dangerously-bypass-approvals-and-sandbox');
    resumeOptions.push('--dangerously-bypass-approvals-and-sandbox');
  } else if (options?.permissionMode === 'plan') {
    newSessionOptions.push('--sandbox', 'read-only');
  } else {
    newSessionOptions.push('--full-auto');
    resumeOptions.push('--full-auto');
  }

  if (options?.model) {
    newSessionOptions.push('--model', options.model);
    resumeOptions.push('--model', options.model);
  }

  for (const imagePath of imagePaths) {
    newSessionOptions.push('--image', imagePath);
    resumeOptions.push('--image', imagePath);
  }

  if (sessionId && !canResume) {
    log.warn('Codex plan mode does not support resume; starting a new read-only session');
  }

  return canResume
    ? ['exec', 'resume', ...resumeOptions, sessionId!, '-']
    : ['exec', ...newSessionOptions, '-'];
}

function quoteForWindowsCmd(arg: string): string {
  if (/^[A-Za-z0-9_./:=+\\-]+$/.test(arg)) {
    return arg;
  }
  const escaped = arg
    .replace(/(\\*)"/g, '$1$1\\"')
    .replace(/(\\+)$/g, '$1$1')
    .replace(/%/g, '%%');
  return `"${escaped}"`;
}

function formatWindowsCommandName(command: string): string {
  if (/^[A-Za-z0-9_.-]+$/.test(command)) {
    return command;
  }
  return quoteForWindowsCmd(command);
}

function extractCodexJsFromCmdShim(cmdPath: string): string | null {
  try {
    const content = readFileSync(cmdPath, 'utf-8');
    const match = content.match(/"%~dp0\\([^"\r\n]*codex\\bin\\codex\.js)"/i);
    if (!match) return null;
    const relativeJsPath = match[1].replace(/\\/g, '/');
    return join(dirname(cmdPath), relativeJsPath);
  } catch (err) {
    log.debug(`Failed to extract Codex JS path from cmd shim ${cmdPath}:`, err);
    return null;
  }
}

function resolveWindowsCodexLaunch(
  cliPath: string,
  args: string[],
): { command: string; args: string[] } | null {
  if (windowsCodexLaunchCache.has(cliPath)) {
    const cached = windowsCodexLaunchCache.get(cliPath);
    return cached ? { command: cached.command, args: [...cached.args, ...args] } : null;
  }

  try {
    const whereOutput = execFileSync('where', [cliPath], {
      stdio: 'pipe',
      windowsHide: true,
    })
      .toString()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const cmdShimPath = whereOutput.find((line) => /\.cmd$/i.test(line)) ?? null;
    if (!cmdShimPath) {
      windowsCodexLaunchCache.set(cliPath, null);
      return null;
    }

    const codexJsPath = extractCodexJsFromCmdShim(cmdShimPath);
    if (!codexJsPath) {
      windowsCodexLaunchCache.set(cliPath, null);
      return null;
    }

    const resolved = {
      command: process.execPath,
      args: [codexJsPath],
    };
    windowsCodexLaunchCache.set(cliPath, resolved);
    return { command: resolved.command, args: [...resolved.args, ...args] };
  } catch (err) {
    log.debug(`Failed to resolve Windows Codex launch for ${cliPath}:`, err);
    windowsCodexLaunchCache.set(cliPath, null);
    return null;
  }
}

export function runCodex(
  cliPath: string,
  prompt: string,
  sessionId: string | undefined,
  workDir: string,
  callbacks: RunCallbacks,
  options?: CodexRunOptions,
): RunHandle {
  const args = buildCodexArgs(prompt, sessionId, workDir, options);

  const extraEnv: Record<string, string | undefined> = {};
  if (options?.chatId) extraEnv.CC_IM_CHAT_ID = options.chatId;
  if (options?.hookPort) extraEnv.CC_IM_HOOK_PORT = String(options.hookPort);
  if (options?.proxy) {
    extraEnv.HTTPS_PROXY = options.proxy;
    extraEnv.HTTP_PROXY = options.proxy;
    extraEnv.https_proxy = options.proxy;
    extraEnv.http_proxy = options.proxy;
    extraEnv.ALL_PROXY = options.proxy;
    extraEnv.all_proxy = options.proxy;
  }

  const argsForLog = args.join(' ');
  log.info(`Spawning Codex CLI: path=${cliPath}, cwd=${workDir}, session=${sessionId ?? 'new'}, args=${argsForLog}`);

  const isWinCmd =
    process.platform === 'win32' &&
    (/\.(cmd|bat)$/i.test(cliPath) || cliPath === 'codex');
  const directWindowsLaunch = isWinCmd ? resolveWindowsCodexLaunch(cliPath, args) : null;
  const spawnCmd = directWindowsLaunch
    ? directWindowsLaunch.command
    : isWinCmd
      ? 'cmd.exe'
      : cliPath;
  const spawnArgs = directWindowsLaunch
    ? directWindowsLaunch.args
    : isWinCmd
      ? [
          '/d',
          '/s',
          '/c',
          `chcp 65001>nul && ${formatWindowsCommandName(cliPath)} ${args.map(quoteForWindowsCmd).join(' ')}`,
        ]
      : args;

  const child = spawn(spawnCmd, spawnArgs, buildBaseSpawnOptions(workDir, ['pipe', 'pipe', 'pipe'], extraEnv));
  trackChild(child);

  child.stdin?.write(prompt);
  child.stdin?.end();

  let accumulated = '';
  let accumulatedThinking = '';
  let completed = false;
  const toolStats: Record<string, number> = {};
  const startTime = Date.now();

  const rl = createInterface({ input: child.stdout! });

  const stderrBuf = createStderrBuffer();

  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    appendStderr(stderrBuf, text);
    log.debug(`[stderr] ${text.trimEnd()}`);
  });

  rl.on('line', (line) => {
    const event = parseCodexEvent(line);
    if (!event) return;

    // Codex CLI JSONL 格式是嵌套的：顶层 type 为 "event_msg" / "response_item"，
    // 真正的子类型在 payload.type 里。旧版扁平格式也兼容。
    const topType = event.type as string;
    const payload = (event.payload as Record<string, unknown> | undefined) ?? event;
    const type = (payload.type as string) ?? topType;
    log.debug(`[Codex event] topType=${topType} type=${type}`);

    // thread.started / session_meta → 拿 session ID
    if (type === 'thread.started' || type === 'session_meta') {
      const threadId = (payload.thread_id as string) ?? (payload.session_id as string) ?? (event.thread_id as string) ?? '';
      if (threadId) callbacks.onSessionId?.(threadId);
      return;
    }

    if (type === 'turn.failed') {
      completed = true;
      const err = (payload.error as { message?: string } | undefined) ?? (event.error as { message?: string } | undefined);
      callbacks.onError(err?.message ?? 'Codex turn failed');
      return;
    }

    if (type === 'error') {
      const msg = (payload.message as string | undefined) ?? (event.message as string | undefined);
      if (msg?.includes('Reconnecting')) {
        return;
      }
      completed = true;
      callbacks.onError(msg ?? 'Codex stream error');
      return;
    }

    // item 事件：payload 里可能有 item 字段，或者 payload 本身就是 item
    if (topType === 'response_item' || type === 'item.started' || type === 'item.updated' || type === 'item.completed') {
      const item = (payload.item as Record<string, unknown> | undefined) ?? payload;
      const itemType = (item.type as string) ?? type;

      if (itemType === 'reasoning') {
        // Codex 的 reasoning 可能是 encrypted_content（不可读），只在有 text 时累加
        const text = item.text as string | undefined;
        if (text) {
          accumulatedThinking += (accumulatedThinking ? '\n\n' : '') + text;
          callbacks.onThinking?.(accumulatedThinking);
        }
        return;
      }

      // function_call（Codex 新格式：response_item.type=function_call）
      if (itemType === 'function_call') {
        const name = (item.name as string | undefined) ?? 'unknown';
        const args = item.arguments as string | undefined;
        const toolName = name === 'exec_command' ? 'Bash' : name === 'apply_patch' ? 'Edit' : name;
        toolStats[toolName] = (toolStats[toolName] || 0) + 1;
        callbacks.onToolUse?.(toolName, args ? { arguments: args } : {});
        return;
      }

      // custom_tool_call（apply_patch 等）
      if (itemType === 'custom_tool_call') {
        const name = (item.name as string | undefined) ?? 'unknown';
        const toolName = name === 'apply_patch' ? 'Edit' : name;
        toolStats[toolName] = (toolStats[toolName] || 0) + 1;
        callbacks.onToolUse?.(toolName, { input: item.input });
        return;
      }

      // command_execution（旧格式）
      if (itemType === 'command_execution') {
        const cmd = item.command as string | undefined;
        if (cmd) {
          toolStats['Bash'] = (toolStats['Bash'] || 0) + 1;
          callbacks.onToolUse?.('Bash', { command: cmd });
        }
        return;
      }

      // file_change（旧格式）
      if (itemType === 'file_change') {
        const changes = item.changes as Array<{ path?: string; kind?: string }> | undefined;
        toolStats['Edit'] = (toolStats['Edit'] || 0) + 1;
        callbacks.onToolUse?.('Edit', { changes });
        return;
      }

      // mcp_tool_call（旧格式）
      if (itemType === 'mcp_tool_call') {
        const tool = item.tool as string | undefined;
        const server = item.server as string | undefined;
        if (tool) {
          const displayName = server ? `${server}/${tool}` : tool;
          toolStats[displayName] = (toolStats[displayName] || 0) + 1;
          callbacks.onToolUse?.(displayName, item.arguments as Record<string, unknown>);
        }
        return;
      }

      // agent_message / message — 最终回复文本
      // Codex 新格式：event_msg.payload.type=agent_message, payload.message=文本
      //              response_item.payload.type=message, payload.content=[{type:output_text,text:...}]
      if (itemType === 'agent_message' || itemType === 'message') {
        let text: string | undefined;
        if (itemType === 'agent_message') {
          text = (item.message as string | undefined) ?? (item.text as string | undefined);
        } else {
          // message 类型，content 是数组
          const content = item.content as Array<{ type?: string; text?: string }> | undefined;
          if (Array.isArray(content)) {
            text = content
              .filter((c) => c.type === 'output_text' && c.text)
              .map((c) => c.text as string)
              .join('\n');
          }
        }
        if (text) {
          // 只累加 final_answer 或 commentary，避免重复
          const phase = (item.phase as string | undefined) ?? (payload.phase as string | undefined);
          accumulated += (accumulated ? '\n\n' : '') + text;
          callbacks.onText(accumulated);
        }
        return;
      }
    }

    // task_complete / turn.completed
    if (type === 'task_complete' || type === 'turn.completed') {
      // task_complete 里可能有 last_agent_message
      const lastMsg = (payload.last_agent_message as string | undefined);
      if (lastMsg && !accumulated) {
        accumulated = lastMsg;
        callbacks.onText(accumulated);
      }
      completed = true;
      callbacks.onComplete({
        success: true,
        result: accumulated,
        accumulated,
        cost: 0,
        durationMs: Date.now() - startTime,
        numTurns: 1,
        toolStats,
      });
    }
  });

  let exitCode: number | null = null;
  const gate = createFinalizeGate();
  let cliTimeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const finalize = () => {
    clearWallClockTimeout(cliTimeoutHandle);
    cliTimeoutHandle = null;
    if (!isFinalizeReady(gate)) return;
    if (completed) return;

    if (exitCode !== null && exitCode !== 0) {
      const errMsg = reconstructStderr(stderrBuf);
      if (sessionId && isSessionInvalidMessage(errMsg)) {
        callbacks.onSessionInvalid?.();
      }
      callbacks.onError(errMsg || `Codex CLI exited with code ${exitCode}`);
      return;
    }

    callbacks.onComplete({
      success: true,
      result: accumulated,
      accumulated,
      cost: 0,
      durationMs: Date.now() - startTime,
      numTurns: 0,
      toolStats,
    });
  };

  child.on('close', (code) => {
    log.info(`Codex CLI closed: exitCode=${code}, pid=${child.pid}`);
    exitCode = code;
    gate.childClosed = true;
    finalize();
  });

  rl.on('close', () => {
    gate.rlClosed = true;
    finalize();
  });

  child.on('error', (err) => {
    const errorCode = (err as NodeJS.ErrnoException).code;
    // EFTYPE / ENOENT / EACCES：cliPath 不可执行、不存在或没有权限。
    // macOS 上缺少 shebang 的脚本会收到 EFTYPE；Windows 上通常是 ENOENT。
    // 给出可操作的修复建议，避免用户只看到冷冰冰的 fork/exec 错误。
    const cliHint =
      errorCode === 'ENOENT'
        ? `Codex CLI 路径不存在：${cliPath}。请检查 config.tools.codex.cliPath 或重新 open-im init。`
        : errorCode === 'EFTYPE'
          ? `Codex CLI 不是有效的可执行文件：${cliPath}（macOS 可执行性/Shebang 检查失败）。请确认 cliPath 指向二进制或带 shebang 的脚本。`
          : errorCode === 'EACCES'
            ? `Codex CLI 没有执行权限：${cliPath}。请 chmod +x 或检查文件所有者。`
            : null;
    log.error(`Codex CLI spawn error: ${err.message}, code=${errorCode}, path=${cliPath}${cliHint ? ` — ${cliHint}` : ''}`);
    if (!completed) {
      completed = true;
      const friendlyMsg = cliHint ?? `无法启动 Codex：${err.message}`;
      callbacks.onError(friendlyMsg);
    }
    gate.childClosed = true;
    finalize();
  });

  // 墙钟超时：防止 CLI 挂死（网络卡住、工具死循环等）永久占用用户队列槽
  const cliTimeoutMs = Number(process.env.OPEN_IM_CLI_TIMEOUT_MS) || 30 * 60 * 1000;
  cliTimeoutHandle = setTimeout(() => {
    if (completed) return;
    completed = true;
    rl.close();
    killProcessTree(child);
    callbacks.onError(`Codex CLI 运行超时（${Math.round(cliTimeoutMs / 1000)}s），已终止。请重试。`);
  }, cliTimeoutMs);
  cliTimeoutHandle.unref();

  return {
    abort: () => {
      if (completed) return;
      completed = true;
      clearWallClockTimeout(cliTimeoutHandle);
      rl.close();
      killProcessTree(child);
    },
  };
}
