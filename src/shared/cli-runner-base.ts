/**
 * Shared CLI runner utilities — stderr buffering, finalize gating,
 * wall-clock timeout, and abort handle.
 *
 * Used by codex, codebuddy, and opencode CLI runners to eliminate
 * duplicated process lifecycle management code.
 */

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import type { Interface as ReadlineInterface } from 'node:readline';
import type { RunHandle } from '../adapters/tool-adapter.interface.js';
import { processEnvForNonClaudeCliChild } from '../config/file-io.js';
import { killProcessTree, trackChild } from './process-kill.js';

// ── stderr head/tail buffer ──────────────────────────────────────

export const MAX_STDERR_HEAD = 4 * 1024;
export const MAX_STDERR_TAIL = 6 * 1024;

export interface StderrBuffer {
  head: string;
  tail: string;
  total: number;
  headFull: boolean;
}

export function createStderrBuffer(): StderrBuffer {
  return { head: '', tail: '', total: 0, headFull: false };
}

export function appendStderr(buf: StderrBuffer, text: string): void {
  buf.total += text.length;
  if (!buf.headFull) {
    const room = MAX_STDERR_HEAD - buf.head.length;
    if (room > 0) {
      buf.head += text.slice(0, room);
      if (buf.head.length >= MAX_STDERR_HEAD) buf.headFull = true;
    }
  }
  buf.tail += text;
  if (buf.tail.length > MAX_STDERR_TAIL) {
    buf.tail = buf.tail.slice(-MAX_STDERR_TAIL);
  }
}

export function reconstructStderr(buf: StderrBuffer): string {
  if (buf.total === 0) return '';
  if (!buf.headFull) return buf.head;
  if (buf.total <= MAX_STDERR_HEAD + MAX_STDERR_TAIL) {
    return buf.head + buf.tail.slice(buf.tail.length - (buf.total - MAX_STDERR_HEAD));
  }
  return (
    buf.head +
    `\n\n... (omitted ${buf.total - MAX_STDERR_HEAD - MAX_STDERR_TAIL} bytes) ...\n\n` +
    buf.tail
  );
}

// ── finalize gate (readline + child dual-close) ──────────────────

export interface FinalizeGate {
  rlClosed: boolean;
  childClosed: boolean;
}

export function createFinalizeGate(): FinalizeGate {
  return { rlClosed: false, childClosed: false };
}

export function isFinalizeReady(gate: FinalizeGate): boolean {
  return gate.rlClosed && gate.childClosed;
}

// ── wall-clock timeout ───────────────────────────────────────────

export function startWallClockTimeout(
  child: ChildProcess,
  timeoutMs: number,
  toolName: string,
  log: { warn: (...args: unknown[]) => void },
  onTimeout: () => void,
  extraCleanup?: () => void,
): ReturnType<typeof setTimeout> {
  const handle = setTimeout(() => {
    log.warn(`${toolName} CLI 超过 ${timeoutMs}ms，强制终止 (pid=${child.pid})`);
    extraCleanup?.();
    onTimeout();
    killProcessTree(child);
  }, timeoutMs);
  handle.unref();
  return handle;
}

export function clearWallClockTimeout(handle: ReturnType<typeof setTimeout> | null): void {
  if (handle) clearTimeout(handle);
}

// ── abort handle ─────────────────────────────────────────────────

export function createAbortHandle(
  completed: { value: boolean },
  child: ChildProcess,
  timeoutHandle: { value: ReturnType<typeof setTimeout> | null },
  rl?: ReadlineInterface,
): RunHandle {
  return {
    abort: () => {
      if (completed.value) return;
      completed.value = true;
      clearWallClockTimeout(timeoutHandle.value);
      timeoutHandle.value = null;
      rl?.close();
      killProcessTree(child);
    },
  };
}

// ── environment and spawn configuration ─────────────────────────

export function buildBaseEnv(extra?: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env = processEnvForNonClaudeCliChild();
  if (process.platform === 'win32') {
    env.LANG = env.LANG || 'C.UTF-8';
    env.LC_ALL = env.LC_ALL || 'C.UTF-8';
  }
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined) env[key] = value;
    }
  }
  return env;
}

export function buildBaseSpawnOptions(
  workDir: string,
  stdio: ('pipe' | 'ignore' | 'inherit')[] = ['pipe', 'pipe', 'pipe'],
  extraEnv?: Record<string, string | undefined>,
): SpawnOptions {
  const opts: SpawnOptions = {
    cwd: workDir,
    detached: process.platform !== 'win32',
    stdio,
    env: buildBaseEnv(extraEnv),
    windowsHide: process.platform === 'win32',
  };
  return opts;
}

export function spawnCliProcess(
  command: string,
  args: string[],
  workDir: string,
  stdio: ('pipe' | 'ignore' | 'inherit')[] = ['pipe', 'pipe', 'pipe'],
  extraEnv?: Record<string, string | undefined>,
): ChildProcess {
  const child = spawn(command, args, buildBaseSpawnOptions(workDir, stdio, extraEnv));
  trackChild(child);
  return child;
}
