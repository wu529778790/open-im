import { loadFileConfig, saveFileConfig } from "../config/file-io.js";
import { loadConfig } from "../config.js";
import type { AiCommand } from "../config/types.js";
import { createLogger } from "../logger.js";
import { getAdapter } from "../adapters/registry.js";
import { ClaudeSDKAdapter } from "../adapters/claude-sdk-adapter.js";
import { CodexAdapter } from "../adapters/codex-adapter.js";
import { CodeBuddyAdapter } from "../adapters/codebuddy-adapter.js";
import { OpenCodeAdapter } from "../adapters/opencode-adapter.js";
import type { ToolAdapter } from "../adapters/tool-adapter.interface.js";

const log = createLogger("Keepalive");

const PING_PROMPT = "在吗";
const PING_TIMEOUT_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;

/** 按需创建临时 adapter（保活的目标 AI 可能未在 enabledPlatforms 中，registry 不会注册） */
function resolveAdapter(target: AiCommand): ToolAdapter | null {
  const cached = getAdapter(target);
  if (cached) return cached;

  const config = loadConfig();
  switch (target) {
    case "claude": return new ClaudeSDKAdapter();
    case "codex": return new CodexAdapter(config.codexCliPath);
    case "codebuddy": return new CodeBuddyAdapter(config.codebuddyCliPath);
    case "opencode": return new OpenCodeAdapter();
    default:
      log.warn(`Unknown AI command: ${target}`);
      return null;
  }
}

/** 发送一句保活消息，等待完成或超时 */
async function ping(target: AiCommand, workDir: string): Promise<boolean> {
  const adapter = resolveAdapter(target);
  if (!adapter) return false;

  log.info(`Keepalive ping → ${target}`);

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (ok: boolean, reason: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      log.info(`Keepalive ${target} ${ok ? "OK" : "FAIL"}: ${reason}`);
      resolve(ok);
    };

    const handle = adapter.run(
      PING_PROMPT,
      undefined,
      workDir,
      {
        onText: () => {},
        onComplete: (r) => settle(r.success, `${r.numTurns} turn(s), ${r.durationMs}ms`),
        onError: (e) => settle(false, `error: ${e}`),
      },
      { skipPermissions: true, skipAutoResume: true },
    );

    const timeoutHandle = setTimeout(() => {
      try {
        handle.abort();
      } catch {
        // 中止失败，忽略错误
      }
      settle(false, `timeout after ${PING_TIMEOUT_MS}ms`);
    }, PING_TIMEOUT_MS);
  });
}

/** 启动保活定时器 */
export function startKeepalive(): void {
  stopKeepalive();

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

  // 不立即执行（启动时不打扰），等到第一个间隔
  timer = setInterval(() => {
    ping(target, workDir).catch((e) => log.warn(`Keepalive ping unhandled: ${e}`));
  }, intervalMs);

  timer.unref?.();
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
  startKeepalive();
}