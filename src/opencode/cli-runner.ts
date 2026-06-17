/**
 * OpenCode CLI runner — spawns `opencode run` in non-interactive mode.
 *
 * OpenCode outputs plain text to stdout. Session continuation uses `-s <id>`.
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createLogger } from '../logger.js';
import { processEnvForNonClaudeCliChild } from '../config/file-io.js';
import { killProcessTree, trackChild } from '../shared/process-kill.js';

const log = createLogger('OpenCodeCli');

export interface OpenCodeRunCallbacks {
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

export interface OpenCodeRunOptions {
  skipPermissions?: boolean;
  model?: string;
}

export interface OpenCodeRunHandle {
  abort: () => void;
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
  callbacks: OpenCodeRunCallbacks,
  options?: OpenCodeRunOptions,
): OpenCodeRunHandle {
  const args = buildOpenCodeArgs(prompt, sessionId, workDir, options);

  const env = processEnvForNonClaudeCliChild();

  log.info(`Spawning OpenCode: path=${cliPath}, cwd=${workDir}, session=${sessionId ?? 'new'}`);

  const child = spawn(cliPath, args, {
    cwd: workDir,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
    windowsHide: process.platform === 'win32',
  });
  trackChild(child);

  // Close stdin — prompt is passed as argument
  child.stdin?.end();

  let accumulated = '';
  let completed = false;
  const toolStats: Record<string, number> = {};
  const startTime = Date.now();

  const rl = createInterface({ input: child.stdout! });

  const MAX_STDERR_HEAD = 4 * 1024;
  const MAX_STDERR_TAIL = 6 * 1024;
  let stderrHead = '';
  let stderrTail = '';
  let stderrTotal = 0;
  let stderrHeadFull = false;

  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    stderrTotal += text.length;
    if (!stderrHeadFull) {
      const room = MAX_STDERR_HEAD - stderrHead.length;
      if (room > 0) {
        stderrHead += text.slice(0, room);
        if (stderrHead.length >= MAX_STDERR_HEAD) stderrHeadFull = true;
      }
    }
    stderrTail += text;
    if (stderrTail.length > MAX_STDERR_TAIL) {
      stderrTail = stderrTail.slice(-MAX_STDERR_TAIL);
    }
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
  let rlClosed = false;
  let childClosed = false;

  const finalize = () => {
    if (!rlClosed || !childClosed) return;
    if (completed) return;

    if (exitCode !== null && exitCode !== 0) {
      let errMsg = '';
      if (stderrTotal > 0) {
        if (!stderrHeadFull) {
          errMsg = stderrHead;
        } else if (stderrTotal <= MAX_STDERR_HEAD + MAX_STDERR_TAIL) {
          errMsg = stderrHead + stderrTail.slice(stderrTail.length - (stderrTotal - MAX_STDERR_HEAD));
        } else {
          errMsg =
            stderrHead +
            `\n\n... (omitted ${stderrTotal - MAX_STDERR_HEAD - MAX_STDERR_TAIL} bytes) ...\n\n` +
            stderrTail;
        }
      }
      if (
        sessionId &&
        (errMsg.includes('session not found') ||
          errMsg.includes('Session not found') ||
          errMsg.includes('no sessions found'))
      ) {
        callbacks.onSessionInvalid?.();
      }
      callbacks.onError(errMsg || `OpenCode exited with code ${exitCode}`);
      return;
    }

    // Exit code 0 but no onComplete fired yet — treat accumulated text as result
    if (!completed) {
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
  };

  rl.on('close', () => {
    rlClosed = true;
    finalize();
  });

  child.on('close', (code) => {
    exitCode = code;
    childClosed = true;
    finalize();
  });

  child.on('error', (err) => {
    log.error('OpenCode spawn error:', err);
    callbacks.onError(`Failed to start OpenCode: ${err.message}`);
  });

  return {
    abort: () => {
      killProcessTree(child);
    },
  };
}
