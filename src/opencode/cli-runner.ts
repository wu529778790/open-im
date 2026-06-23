/**
 * OpenCode CLI runner — spawns `opencode run` in non-interactive mode.
 *
 * OpenCode outputs plain text to stdout. Session continuation uses `-s <id>`.
 */

import { createInterface } from 'node:readline';
import { createLogger } from '../logger.js';
import { killProcessTree } from '../shared/process-kill.js';
import { isSessionInvalidMessage } from '../shared/session-invalid-detector.js';
import {
  createStderrBuffer,
  appendStderr,
  reconstructStderr,
  createFinalizeGate,
  isFinalizeReady,
  clearWallClockTimeout,
  spawnCliProcess,
} from '../shared/cli-runner-base.js';
import type { RunCallbacks, RunHandle } from '../adapters/tool-adapter.interface.js';

const log = createLogger('OpenCodeCli');

export interface OpenCodeRunOptions {
  skipPermissions?: boolean;
  model?: string;
}

export function buildOpenCodeArgs(
  prompt: string,
  sessionId: string | undefined,
  workDir: string,
  options?: OpenCodeRunOptions,
): string[] {
  const args: string[] = ['run'];

  // Working directory
  args.push('--dir', workDir);

  // Session continuation
  if (sessionId) {
    args.push('--session', sessionId);
  }

  // Model override
  if (options?.model) {
    args.push('--model', options.model);
  }

  // Skip permissions
  if (options?.skipPermissions) {
    args.push('--dangerously-skip-permissions');
  }

  // Prompt as positional argument
  args.push(prompt);

  return args;
}

export function runOpenCode(
  cliPath: string,
  prompt: string,
  sessionId: string | undefined,
  workDir: string,
  callbacks: RunCallbacks,
  options?: OpenCodeRunOptions,
): RunHandle {
  const args = buildOpenCodeArgs(prompt, sessionId, workDir, options);

  log.info(`Spawning OpenCode: path=${cliPath}, cwd=${workDir}, session=${sessionId ?? 'new'}`);

  const child = spawnCliProcess(cliPath, args, workDir);

  // Close stdin — prompt is passed as argument
  child.stdin?.end();

  let accumulated = '';
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
    if (completed) return;

    // OpenCode outputs plain text — accumulate each line
    const trimmed = line.trim();
    if (!trimmed) return;

    // Skip spinner lines (ANSI escape sequences or common spinner chars)
    if (/^[⠀-⣿\s⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏▪●◆⬤◉⬤⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]+$/.test(trimmed)) return;

    accumulated += (accumulated ? '\n' : '') + line;
    callbacks.onText(accumulated);
  });

  // Also capture stdout as a raw stream for binary-like streaming
  child.stdout?.on('data', (chunk: Buffer) => {
    // The readline interface handles line-by-line, but we also
    // want to capture any partial data for streaming updates
    const text = chunk.toString();
    if (!completed && text.trim()) {
      log.debug(`[stdout chunk] ${text.substring(0, 200)}`);
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
      callbacks.onError(errMsg || `OpenCode exited with code ${exitCode}`);
      return;
    }

    // Exit code 0 but no onComplete fired yet — treat accumulated text as result
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
  };

  rl.on('close', () => {
    gate.rlClosed = true;
    finalize();
  });

  child.on('close', (code) => {
    exitCode = code;
    gate.childClosed = true;
    finalize();
  });

  child.on('error', (err) => {
    log.error('OpenCode spawn error:', err);
    if (!completed) {
      completed = true;
      callbacks.onError(`Failed to start OpenCode: ${err.message}`);
    }
    gate.childClosed = true;
    finalize();
  });

  // 墙钟超时：防止 CLI 挂死永久占用用户队列槽
  const cliTimeoutMs = Number(process.env.OPEN_IM_CLI_TIMEOUT_MS) || 30 * 60 * 1000;
  cliTimeoutHandle = setTimeout(() => {
    if (completed) return;
    completed = true;
    rl.close();
    killProcessTree(child);
    callbacks.onError(`OpenCode CLI 运行超时（${Math.round(cliTimeoutMs / 1000)}s），已终止。请重试。`);
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
