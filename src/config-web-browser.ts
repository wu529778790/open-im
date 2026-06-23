import { spawn } from "node:child_process";
import { WEB_CONFIG_PORT, getPublicWebDashboardUrl } from "./constants.js";
import { createLogger } from "./logger.js";

const log = createLogger("ConfigWeb");

export function openBrowser(url: string): void {
  // 显式关闭自动打开浏览器（服务器环境推荐设置）
  if (process.env.OPEN_IM_NO_BROWSER === "1") {
    return;
  }

  // 在无 TTY 且无图形环境（常见于服务器）时直接跳过，避免无意义的 xdg-open 调用
  if (!process.stdout.isTTY && !process.env.DISPLAY) {
    log.info(`Skipping browser launch for URL ${url} (no TTY/DISPLAY detected).`);
    return;
  }

  const safeSpawn = (command: string, args: string[]): void => {
    try {
      const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: process.platform === "win32" });
      // 防止 ENOENT 之类的错误变成未捕获异常
      child.on("error", (error: NodeJS.ErrnoException) => {
        log.warn(`Failed to launch browser command "${command}": ${error.code ?? error.message}`);
      });
      child.unref();
    } catch (error) {
      log.warn(`Failed to spawn browser command "${command}": ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  if (process.platform === "win32") {
    safeSpawn("cmd", ["/c", "start", "", url]);
    return;
  }
  if (process.platform === "darwin") {
    safeSpawn("open", [url]);
    return;
  }
  // linux / 其他 UNIX 平台：优先尝试 xdg-open，失败时仅记录日志，不抛出
  safeSpawn("xdg-open", [url]);
}

export function getWebConfigPort(): number {
  const fromEnv = process.env.OPEN_IM_WEB_PORT ? parseInt(process.env.OPEN_IM_WEB_PORT, 10) : NaN;
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : WEB_CONFIG_PORT;
}

export function getWebConfigUrl(): string {
  return `http://127.0.0.1:${getWebConfigPort()}`;
}

export function openWebConfigUrl(): void {
  openBrowser(getPublicWebDashboardUrl());
}
