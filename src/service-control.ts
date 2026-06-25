import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_HOME, SHUTDOWN_PORT, SERVICE_READY_TIMEOUT_MS, HEALTH_CHECK_TIMEOUT_MS } from "./constants.js";
import { resolveNodeExecutable } from "./node-exec.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PID_FILE = join(APP_HOME, "open-im-worker.pid");
const PORT_FILE = join(APP_HOME, "open-im.port");
/** 重启请求标志文件：worker 优雅退出前置于此文件，manager 的 exit 监听据此判断是否重生 worker。 */
const RESTART_REQUESTED_FILE = join(APP_HOME, "open-im.restart-requested");

function removePortFile(): void {
  try {
    if (existsSync(PORT_FILE)) unlinkSync(PORT_FILE);
  } catch {
    /* ignore */
  }
}

// ─── 重启请求标志文件（worker ↔ manager 协作） ───

/** 写入重启请求标志。reason 与时间戳一并记录，便于日志追溯。供 worker 的 /restart 调用。 */
export function markRestartRequest(reason: string): void {
  try {
    const dir = dirname(RESTART_REQUESTED_FILE);
    if (!existsSync(dir)) return; // APP_HOME 通常已存在；防御性
    writeFileSync(
      RESTART_REQUESTED_FILE,
      JSON.stringify({ reason, at: new Date().toISOString() }, null, 2),
      "utf-8",
    );
  } catch {
    /* 写失败则 manager 不会重生，退化为普通关闭 */
  }
}

/** 是否存在待处理的重启请求。供 manager 的 worker exit 监听判断是否重生。 */
export function hasRestartRequested(): boolean {
  return existsSync(RESTART_REQUESTED_FILE);
}

/** 清除重启请求标志。manager 重生 worker 前调用，避免重复触发。 */
export function clearRestartRequest(): void {
  try {
    if (existsSync(RESTART_REQUESTED_FILE)) unlinkSync(RESTART_REQUESTED_FILE);
  } catch {
    /* ignore */
  }
}

function getServiceEntry(): { command: string; args: string[] } {
  const node = resolveNodeExecutable();
  const extension = extname(fileURLToPath(import.meta.url));
  if (extension === ".ts") {
    return {
      command: node,
      args: ["--import", "tsx", join(__dirname, "index.ts")],
    };
  }

  return {
    command: node,
    args: [join(__dirname, "index.js")],
  };
}

export function getPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  try {
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

export function writePid(pid: number): void {
  writeFileSync(PID_FILE, String(pid), "utf-8");
}

export function removePid(): void {
  try {
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
  } catch {
    /* ignore */
  }
}

export function isRunning(pid: number): boolean {
  try {
    if (process.platform === "win32") {
      const result = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/NH"], {
        stdio: "pipe",
        windowsHide: true,
      }).toString();
      return result.includes(String(pid));
    }
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function getServiceStatus(): { running: boolean; pid: number | null } {
  const pid = getPid();
  if (!pid) return { running: false, pid: null };
  if (!isRunning(pid)) {
    removePid();
    removePortFile();
    return { running: false, pid: null };
  }
  return { running: true, pid };
}

/**
 * Spawn the background service (worker).
 * Returns the child handle so the manager can supervise it.
 * If a worker is already running, returns its pid with a null child (manager supervision
 * already has a child from the initial spawn; web UI callers only need the pid).
 */
export function startBackgroundService(cwd: string): { pid: number; child: ChildProcess | null } {
  const current = getServiceStatus();
  if (current.running && current.pid) {
    return { pid: current.pid, child: null };
  }

  removePid();
  removePortFile();
  const entry = getServiceEntry();
  const child = spawn(entry.command, entry.args, {
    detached: true,
    stdio: "ignore",
    cwd,
    env: process.env,
    windowsHide: process.platform === "win32",
  });
  child.on("error", (err) => {
    // Spawn failure (ENOENT etc.) — report via stderr since logger may not be initialized
    process.stderr.write(`[service-control] Spawn failed: ${err.message}\n`);
  });
  child.unref();

  if (!child.pid) {
    throw new Error("Failed to start background service.");
  }

  writePid(child.pid);
  return { pid: child.pid, child };
}

export async function waitForBackgroundServiceReady(
  timeoutMs = SERVICE_READY_TIMEOUT_MS,
  pollIntervalMs = 100,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const status = getServiceStatus();
    if (!status.running || !status.pid) {
      throw new Error("Background service exited before becoming ready.");
    }

    if (existsSync(PORT_FILE)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error("Background service did not become ready in time.");
}

export async function stopBackgroundService(): Promise<{ pid: number | null; stopped: boolean }> {
  const pid = getPid();
  if (!pid) return { pid: null, stopped: false };
  if (!isRunning(pid)) {
    removePid();
    return { pid, stopped: true };
  }

  const port = existsSync(PORT_FILE)
    ? parseInt(readFileSync(PORT_FILE, "utf-8").trim(), 10) || SHUTDOWN_PORT
    : SHUTDOWN_PORT;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/shutdown`, {
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
    });
    if (response.ok) {
      for (let index = 0; index < 50; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (!isRunning(pid)) break;
      }
    }
  } catch {
    process.kill(pid, "SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (isRunning(pid)) {
    process.kill(pid, "SIGKILL");
  }

  removePid();
  removePortFile();

  return { pid, stopped: true };
}
