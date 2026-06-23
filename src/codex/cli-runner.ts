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

    const type = event.type as string;
    log.debug(`[Codex event] type=${type}`);

    if (type === 'thread.started') {
      const threadId = (event.thread_id as string) ?? '';
      if (threadId) callbacks.onSessionId?.(threadId);
      return;
    }

    if (type === 'turn.failed') {
      completed = true;
      const err = event.error as { message?: string } | undefined;
      callbacks.onError(err?.message ?? 'Codex turn failed');
      return;
    }

    if (type === 'error') {
      const msg = event.message as string | undefined;
      if (msg?.includes('Reconnecting')) {
        return;
      }
      completed = true;
      callbacks.onError(msg ?? 'Codex stream error');
      return;
    }

    if (type === 'item.started' || type === 'item.updated' || type === 'item.completed') {
      const item = event.item as Record<string, unknown> | undefined;
      if (!item) return;

      const itemType = item.type as string;

      if (itemType === 'reasoning' && type === 'item.completed') {
        const text = item.text as string | undefined;
        if (text) {
          accumulatedThinking += (accumulatedThinking ? '\n\n' : '') + text;
          callbacks.onThinking?.(accumulatedThinking);
        }
        return;
      }

      if (itemType === 'command_execution') {
        const cmd = item.command as string | undefined;
        if (cmd && type === 'item.started') {
          const toolName = 'Bash';
          toolStats[toolName] = (toolStats[toolName] || 0) + 1;
          callbacks.onToolUse?.(toolName, { command: cmd });
        }
        return;
      }

      if (itemType === 'file_change' && type === 'item.completed') {
        const changes = item.changes as Array<{ path?: string; kind?: string }> | undefined;
        const toolName = 'Edit';
        toolStats[toolName] = (toolStats[toolName] || 0) + 1;
        callbacks.onToolUse?.(toolName, { changes });
        return;
      }

      if (itemType === 'mcp_tool_call' && type === 'item.started') {
        const tool = item.tool as string | undefined;
        const server = item.server as string | undefined;
        if (tool) {
          const displayName = server ? `${server}/${tool}` : tool;
          toolStats[displayName] = (toolStats[displayName] || 0) + 1;
          callbacks.onToolUse?.(displayName, item.arguments as Record<string, unknown>);
        }
        return;
      }

      if (itemType === 'agent_message' && type === 'item.completed') {
        const text = item.text as string | undefined;
        if (text) {
          accumulated += (accumulated ? '\n\n' : '') + text;
          callbacks.onText(accumulated);
        }
        return;
      }
    }

    if (type === 'turn.completed') {
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
    log.error(`Codex CLI spawn error: ${err.message}, code=${errorCode}, path=${cliPath}`);
    if (!completed) {
      completed = true;
      callbacks.onError(`Failed to start Codex CLI: ${err.message}`);
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
