import type { ChildProcess } from "node:child_process";
import { startWebConfigServer } from "./config-web.js";
import { removeManagerPid, removeManagerReady, writeManagerReady } from "./manager-control.js";
import {
  startBackgroundService,
  stopBackgroundService,
  waitForBackgroundServiceReady,
  hasRestartRequested,
  clearRestartRequest,
} from "./service-control.js";
import { createLogger } from "./logger.js";
import { loadFileConfig } from "./config.js";

const log = createLogger("Manager");

async function main(): Promise<void> {
  const file = loadFileConfig();
  const workDir = file.tools?.claude?.workDir ?? process.cwd();
  const web = await startWebConfigServer({ mode: "start", cwd: workDir, persistent: true });

  // manager 是否正在主动关闭。置位后 worker 的 exit 回调不再重生，避免 stop 触发误拉起。
  const state = { managerStopping: false };

  /**
   * 监督 worker 子进程：退出时若 worker 在退出前置写了重启请求标志文件（/restart），
   * 则重新 spawn 一个 worker 并继续监督；否则不自动拉起（保持原"崩溃不重启"行为，
   * 但已为此 supervisor 预留扩展点）。
   *
   * 用具名函数递归挂监听，避免回调嵌套；每个 child 只挂一次。
   */
  function supervise(child: ChildProcess | null): void {
    if (!child) return;
    child.on("exit", (code, signal) => {
      // manager 主动 stop：stopBackgroundService 会让 worker 退出，此时不应重生。
      if (state.managerStopping) {
        log.info(`Worker exited during manager shutdown (code=${code}, signal=${signal}).`);
        return;
      }
      if (hasRestartRequested()) {
        clearRestartRequest();
        log.info("Restart requested, respawning worker...");
        try {
          const next = startBackgroundService(workDir);
          supervise(next.child);
          waitForBackgroundServiceReady().catch((err) => {
            log.error("Respawned worker failed to become ready:", err);
          });
        } catch (err) {
          log.error("Failed to respawn worker:", err);
        }
      } else {
        // 非 restart 的退出：不自动拉起（保持现状），仅记录。
        log.warn(`Worker exited (code=${code}, signal=${signal}), not respawning.`);
      }
    });
  }

  // 首次启动 worker 并监督：worker 退出时，若存在重启请求则重生，否则视为崩溃/正常退出。
  const initial = startBackgroundService(workDir);
  supervise(initial.child);
  await waitForBackgroundServiceReady();
  writeManagerReady();

  const shutdown = async () => {
    state.managerStopping = true;
    await web.close().catch((err) => log.warn("Failed to close web server:", err));
    await stopBackgroundService().catch((err) => log.warn("Failed to stop background service:", err));
    removeManagerReady();
    removeManagerPid();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown().catch(() => process.exit(1)));
  process.on("SIGTERM", () => shutdown().catch(() => process.exit(1)));
}

const isEntry =
  process.argv[1]?.replace(/\\/g, "/").endsWith("/manager.js") ||
  process.argv[1]?.replace(/\\/g, "/").endsWith("/manager.ts");

if (isEntry) {
  main().catch((error) => {
    log.error("Manager fatal error:", error);
    removeManagerReady();
    removeManagerPid();
    process.exit(1);
  });
}
