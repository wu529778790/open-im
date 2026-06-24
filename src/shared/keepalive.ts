import { loadFileConfig, saveFileConfig } from "../config/file-io.js";
import { loadConfig } from "../config.js";
import type { AiCommand } from "../config/types.js";
import { createLogger } from "../logger.js";

const log = createLogger("Keepalive");

let timer: ReturnType<typeof setInterval> | null = null;

/** 对 Claude SDK 执行一次保活请求 */
async function pingClaude(workDir: string): Promise<boolean> {
  try {
    const { ClaudeSDKAdapter } = await import("../adapters/claude-sdk-adapter.js");
    const info = await ClaudeSDKAdapter.getAccountInfo(workDir);
    if (info) {
      const str = JSON.stringify(info).substring(0, 100);
      log.info(`Keepalive ping OK: ${str}`);
      return true;
    }
    log.warn("Keepalive ping returned no account info");
    return false;
  } catch (err) {
    log.warn(`Keepalive ping failed: ${err}`);
    return false;
  }
}

/** 通用保活 ping */
async function ping(target: AiCommand, workDir: string): Promise<boolean> {
  switch (target) {
    case "claude":
      return pingClaude(workDir);
    // 其他 AI 工具后续可按需实现
    default:
      log.info(`Keepalive: ${target} 的保活尚未实现，跳过`);
      return false;
  }
}

/** 启动保活定时器 */
export function startKeepalive(): void {
  stopKeepalive(); // 确保不重复

  const file = loadFileConfig();
  const ka = file.keepalive ?? {};
  const enabled = ka.enabled ?? true;
  const intervalHours = ka.intervalHours ?? 5;
  const target: AiCommand = (ka.target as AiCommand) ?? "claude";

  if (!enabled) {
    log.info("Keepalive 已禁用，跳过");
    return;
  }

  const config = loadConfig();
  const workDir = config.claudeWorkDir;
  const intervalMs = intervalHours * 60 * 60 * 1000;

  log.info(`Keepalive 已启动，每 ${intervalHours} 小时 ping ${target}`);

  // 立即执行一次
  ping(target, workDir);

  // 定时执行
  timer = setInterval(() => {
    ping(target, workDir);
  }, intervalMs);

  timer.unref?.(); // 不阻止进程退出
}

/** 停止保活定时器 */
export function stopKeepalive(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    log.info("Keepalive 已停止");
  }
}

/** 从 API 读取保活配置（返回给前端） */
export function getKeepaliveConfig() {
  const file = loadFileConfig();
  const ka = file.keepalive ?? {};
  return {
    enabled: ka.enabled ?? true,
    intervalHours: ka.intervalHours ?? 5,
    target: ka.target ?? "claude",
  };
}

/** 从 API 保存保活配置 */
export function saveKeepaliveConfig(cfg: { enabled: boolean; intervalHours: number; target: string }): void {
  const file = loadFileConfig();
  file.keepalive = {
    enabled: cfg.enabled,
    intervalHours: cfg.intervalHours,
    target: cfg.target as AiCommand,
  };
  saveFileConfig(file);
  // 保存后立即重启定时器
  startKeepalive();
}