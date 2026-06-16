/**
 * 跨平台子进程树终止：用于 Codex / CodeBuddy CLI 子进程。
 *
 * 在 Unix 上子进程需以 `detached: true` 启动，使其成为独立进程组的组长；
 * 这样 `process.kill(-pid)` 才能同时命中 CLI 及其派生的孙进程（MCP server、
 * shell 工具调用等）。Windows 不支持负 PID 信号，改用 `taskkill /T /F`
 * 按 PID 递归终止整棵进程树。
 *
 * 进程退出（shutdown / 崩溃）时，`destroyAllLiveChildren()` 会强制清理所有
 * 仍在运行的被追踪子进程，避免僵尸 / 孤儿进程。
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createLogger } from '../logger.js';

const log = createLogger('ProcessKill');

/** 当前被追踪的存活子进程，供关停时强制清理。 */
const liveChildren = new Set<ChildProcess>();

/** 追踪一个已 spawn 的子进程，使其在关停时能被强制终止。 */
export function trackChild(child: ChildProcess): ChildProcess {
  liveChildren.add(child);
  child.once('close', () => liveChildren.delete(child));
  return child;
}

/** 向整棵进程树发送信号：Unix 用负 PID（整组），Windows 用 taskkill /T /F。 */
function signalTree(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid;
  if (pid == null) return;
  try {
    if (process.platform === 'win32') {
      // Windows 没有「优雅 SIGTERM」语义，统一 /T（递归） /F（强制）
      const tk = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      tk.unref();
    } else {
      process.kill(-pid, signal);
    }
  } catch (err) {
    // ESRCH（已退出）或未 detached（无独立进程组）——退化为直接信号
    try {
      child.kill(signal);
    } catch {
      /* 进程已退出，忽略 */
    }
    log.debug(`signalTree(${signal}) for pid=${pid} 退化为直杀: ${(err as Error).message}`);
  }
}

/**
 * 终止子进程及其所有后代。默认优雅：先 SIGTERM，`graceMs` 后升级为 SIGKILL。
 * 传 `force: true` 则立即 SIGKILL（用于关停）。
 */
export function killProcessTree(
  child: ChildProcess,
  opts: { force?: boolean; graceMs?: number } = {}
): void {
  const { force = false, graceMs = 5000 } = opts;
  if (child.pid == null) return;
  if (force) {
    signalTree(child, 'SIGKILL');
    return;
  }
  signalTree(child, 'SIGTERM');
  const escalate = setTimeout(() => signalTree(child, 'SIGKILL'), graceMs);
  escalate.unref();
}

/** 强制终止所有仍在运行的被追踪子进程。关停 / 进程退出时调用。 */
export function destroyAllLiveChildren(): void {
  for (const child of [...liveChildren]) {
    try {
      signalTree(child, 'SIGKILL');
    } catch {
      /* best effort */
    }
  }
  liveChildren.clear();
}
