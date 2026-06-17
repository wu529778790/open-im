import { createServer } from "node:http";
import { writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { getConfiguredAiCommands, loadConfig, needsSetup, resolvePlatformAiCommand, type Platform } from "./config.js";
import { runInteractiveSetup, runClaudeApiSetup } from "./setup.js";
import { runWebConfigFlow } from "./config-web.js";

// 导出供 cli.ts 使用
export { needsSetup, runInteractiveSetup };
import { initTelegram, stopTelegram } from "./telegram/client.js";
import { setupTelegramHandlers } from "./telegram/event-handler.js";
import { sendTextReply as sendTelegramTextReply } from "./telegram/message-sender.js";
import { initFeishu, stopFeishu, formatFeishuInitError } from "./feishu/client.js";
import { setupFeishuHandlers } from "./feishu/event-handler.js";
import { sendTextReply as sendFeishuTextReply } from "./feishu/message-sender.js";
import { initQQ, stopQQ } from "./qq/client.js";
import { setupQQHandlers } from "./qq/event-handler.js";
import { sendTextReply as sendQQTextReply } from "./qq/message-sender.js";
import { initWeWork, stopWeWork } from "./wework/client.js";
import { setupWeWorkHandlers } from "./wework/event-handler.js";
import { sendProactiveTextReply as sendWeWorkTextReply } from "./wework/message-sender.js";
import { initDingTalk, stopDingTalk, formatDingTalkInitError } from "./dingtalk/client.js";
import { setupDingTalkHandlers } from "./dingtalk/event-handler.js";
import { initWorkBuddy, stopWorkBuddy } from "./workbuddy/client.js";
import { setupWorkBuddyHandlers } from "./workbuddy/event-handler.js";
import { sendTextReply as sendWorkBuddyTextReply } from "./workbuddy/message-sender.js";
import { initClawbot, stopClawbot } from "./clawbot/client.js";
import { setupClawbotHandlers } from "./clawbot/event-handler.js";
import { sendTextReply as sendClawbotTextReply } from "./clawbot/message-sender.js";
import { initClawBotSender } from "./clawbot/message-sender.js";
import { initAdapters, cleanupAdapters } from "./adapters/registry.js";
import { SessionManager } from "./session/session-manager.js";
import {
  loadActiveChats,
  getActiveChatId,
  flushActiveChats,
} from "./shared/active-chats.js";
import { destroyAllLiveChildren } from "./shared/process-kill.js";
import {
  initLogger,
  createLogger,
  closeLogger,
  emitStructuredEvent,
  shutdownLoggerTelemetry,
} from "./logger.js";
import { APP_HOME, SHUTDOWN_PORT } from "./constants.js";
import { createRequire } from "node:module";
import { escapePathForMarkdown, getAIToolDisplayName } from "./shared/utils.js";
import { applyOpenImGitCoauthorToProcessEnv } from "./shared/git-coauthor.js";
import { emitInterruptedTerminals } from "./shared/task-cleanup.js";

const require = createRequire(import.meta.url);
const { version: APP_VERSION } = require("../package.json") as {
  version: string;
};

const log = createLogger("Main");

// --- Data-driven platform module descriptors ---
// Each entry encapsulates init, stop, and optional notification logic for one platform.

interface PlatformHandle {
  stop: () => void;
  runningTasks?: Map<string, import('./shared/ai-task.js').TaskRunState>;
}

interface PlatformModule {
  init: (config: ReturnType<typeof loadConfig>, sessionManager: SessionManager) => Promise<PlatformHandle>;
  stop: () => void | Promise<void>;
  sendNotification?: (chatId: string, message: string) => Promise<void>;
  formatError?: (err: unknown) => string;
}

const PLATFORM_MODULES: Record<Platform, PlatformModule> = {
  telegram: {
    init: (config, sessionManager) =>
      new Promise<PlatformHandle>((resolve, reject) => {
        initTelegram(config, (bot) => {
          resolve(setupTelegramHandlers(bot, config, sessionManager));
        }).catch(reject);
      }),
    stop: () => stopTelegram(),
    sendNotification: (chatId, msg) => sendTelegramTextReply(chatId, msg),
  },
  feishu: {
    init: async (config, sessionManager) => {
      const handle = setupFeishuHandlers(config, sessionManager);
      await initFeishu(config, handle.handleEvent);
      return handle;
    },
    stop: () => stopFeishu(),
    sendNotification: (chatId, msg) => sendFeishuTextReply(chatId, msg),
    formatError: (err) => formatFeishuInitError(err),
  },
  qq: {
    init: async (config, sessionManager) => {
      const handle = setupQQHandlers(config, sessionManager);
      await initQQ(config, handle.handleEvent);
      return handle;
    },
    stop: () => stopQQ(),
    sendNotification: (chatId, msg) => sendQQTextReply(chatId, msg),
  },
  wework: {
    init: async (config, sessionManager) => {
      const handle = setupWeWorkHandlers(config, sessionManager);
      await initWeWork(config, handle.handleEvent);
      return handle;
    },
    stop: () => stopWeWork(),
    sendNotification: (chatId, msg) => sendWeWorkTextReply(chatId, msg),
  },
  dingtalk: {
    init: async (config, sessionManager) => {
      const handle = setupDingTalkHandlers(config, sessionManager);
      await initDingTalk(config, handle.handleEvent);
      return handle;
    },
    stop: () => stopDingTalk(),
    formatError: (err) => formatDingTalkInitError(err),
    // No sendNotification — DingTalk doesn't support proactive messaging
  },
  workbuddy: {
    init: async (config, sessionManager) => {
      const handle = setupWorkBuddyHandlers(config, sessionManager);
      await initWorkBuddy(config, handle.handleEvent);
      return handle;
    },
    stop: () => stopWorkBuddy(),
    sendNotification: (chatId, msg) => sendWorkBuddyTextReply(null, chatId, msg, randomUUID()),
  },
  clawbot: {
    init: async (config, sessionManager) => {
      const pc = config.platforms.clawbot;
      if (pc?.apiUrl && pc?.apiToken) {
        initClawBotSender(pc.apiUrl, pc.apiToken);
      }
      const handle = setupClawbotHandlers(config, sessionManager);
      await initClawbot(config, handle.handleEvent);
      return handle;
    },
    stop: () => stopClawbot(),
    sendNotification: (chatId, msg) => sendClawbotTextReply(chatId, msg),
  },
};

async function sendLifecycleNotification(platform: Platform, message: string) {
  const mod = PLATFORM_MODULES[platform];
  if (!mod?.sendNotification) {
    log.debug(`[${platform}] No sendNotification, skipping lifecycle notification`);
    return;
  }

  const chatId = getActiveChatId(platform);
  if (!chatId) {
    log.info(`[${platform}] No active chatId, skipping lifecycle notification`);
    return;
  }

  log.info(`[${platform}] Sending lifecycle notification to chatId=${chatId}`);
  await mod.sendNotification(chatId, message);
  log.info(`[${platform}] Lifecycle notification sent successfully`);
}

const PLATFORM_DISPLAY_NAMES: Record<string, string> = {
  telegram: 'Telegram',
  feishu: '飞书',
  wework: '企业微信',
  dingtalk: '钉钉',
  qq: 'QQ',
  workbuddy: '微信',
  clawbot: '微信 (ClawBot)',
};

function buildStartupMessage(
  platform: string,
  appVersion: string,
  aiCommand: string,
  defaultWorkDir: string,
  sessionManager: SessionManager,
): string {
  let sessionDir: string | undefined;

  // Telegram 私聊、企业微信当前实现里，活跃 chatId 可直接对应到 session userId。
  if (platform === "telegram" || platform === "wework") {
    const activeChatId = getActiveChatId(platform);
    if (activeChatId) {
      sessionDir = sessionManager.getWorkDir(activeChatId);
    }
  }

  const platformName = PLATFORM_DISPLAY_NAMES[platform] ?? platform;
  const toolName = getAIToolDisplayName(aiCommand);
  const dir = sessionDir ? escapePathForMarkdown(sessionDir) : '发送 `/pwd` 查看';

  return [
    `✅ open-im v${appVersion} 已就绪`,
    "",
    `📱 平台: ${platformName}`,
    `🤖 AI: ${toolName}`,
    `📁 目录: ${dir}`,
  ].join("\n\n");
}

function buildShutdownMessage(uptimeMinutes: number): string {
  const uptime = uptimeMinutes < 1 ? '< 1' : String(uptimeMinutes);
  return [
    `🛑 open-im 正在关闭`,
    "",
    `⏱️ 运行时长: ${uptime} 分钟`,
  ].join("\n\n");
}

export async function main() {
  const startupCwd = process.cwd();

  if (needsSetup()) {
    const saved = process.stdin.isTTY
      ? (await runWebConfigFlow({ mode: "dev", cwd: process.cwd() })) === "saved"
      : await runInteractiveSetup();
    if (!saved) process.exit(1);
  }

  const CLAUDE_API_CRED_ERROR = "未配置 Claude API 凭证";
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
    initLogger({
      logDir: config.logDir,
      logLevel: config.logLevel,
      telemetry: config.telemetry,
    });
    applyOpenImGitCoauthorToProcessEnv();
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes(CLAUDE_API_CRED_ERROR) &&
      process.stdin.isTTY
    ) {
      log.info("检测到未配置 Claude API 凭证，启动配置向导...");
      const saved = await runClaudeApiSetup();
      if (!saved) process.exit(1);
      config = loadConfig();
      initLogger({
        logDir: config.logDir,
        logLevel: config.logLevel,
        telemetry: config.telemetry,
      });
      applyOpenImGitCoauthorToProcessEnv();
    } else {
      throw err;
    }
  }

  loadActiveChats();

  initAdapters(config);

  // 尽早启动 shutdown 并写入 port 文件，使 open-im start 的 8s 就绪超时能通过（平台初始化可能较慢）
  let shutdownServer: ReturnType<typeof createServer> | null = null;
  await new Promise<void>((resolve, reject) => {
    shutdownServer = createServer((req, res) => {
      if (req.url === "/shutdown" || req.url === "/") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
        shutdown().catch(() => process.exit(1));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    shutdownServer!.listen(SHUTDOWN_PORT, "127.0.0.1", () => {
      const portFile = join(APP_HOME, "open-im.port");
      const dir = dirname(portFile);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(portFile, String(SHUTDOWN_PORT), "utf-8");
      resolve();
    });
    shutdownServer!.on("error", reject);
  });

  log.info("Starting open-im bridge...");
  log.info(`AI 工具: ${getConfiguredAiCommands(config).join(", ")}`);
  log.info(`默认会话目录(本次启动 cwd): ${startupCwd}`);
  if (startupCwd !== config.claudeWorkDir) {
    log.info(`历史默认会话目录(配置中的 claudeWorkDir): ${config.claudeWorkDir}`);
  }
  log.info(`启用平台: ${config.enabledPlatforms.join(", ")}`);

  const sessionManager = new SessionManager(startupCwd, config.claudeWorkDir);
  // Codex/CodeBuddy 的 sessionId 持久化在 sessions.json；重启后沿用以便 --resume 续聊。
  // 若 CLI 判定会话无效，ai-task 会通过 onSessionInvalid 清理并提示重试。

  // Track active platform handles and successfully initialized platforms
  const activeHandles = new Map<Platform, PlatformHandle>();
  const successfulPlatforms: Platform[] = [];

  for (const platform of config.enabledPlatforms) {
    const mod = PLATFORM_MODULES[platform];
    if (!mod) {
      log.warn(`Unknown platform: ${platform}`);
      continue;
    }
    try {
      const handle = await mod.init(config, sessionManager);
      activeHandles.set(platform, handle);
      successfulPlatforms.push(platform);
    } catch (err) {
      const errorMsg = mod.formatError ? mod.formatError(err) : String(err);
      log.error(`Failed to initialize ${platform}:`, errorMsg);
    }
  }

  // Require at least one platform to start successfully
  if (successfulPlatforms.length === 0) {
    throw new Error("No platforms initialized successfully. Service cannot start.");
  }

  log.info("Service is running. Press Ctrl+C to stop.");
  log.info(`Successfully initialized platforms: ${successfulPlatforms.join(", ")}`);

  emitStructuredEvent("Main", "service.platform.init", {
    platforms: successfulPlatforms,
    version: APP_VERSION,
  });

  // Send notification only to successfully initialized platforms
  for (const platform of successfulPlatforms) {
    const startupMsg = buildStartupMessage(
      platform,
      APP_VERSION,
      resolvePlatformAiCommand(config, platform),
      startupCwd,
      sessionManager,
    );
    await sendLifecycleNotification(platform, startupMsg).catch((err) => {
      log.warn(`Failed to send startup notification to ${platform}:`, err);
    });
  }

  const startedAt = Date.now();
  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("Shutting down...");
    const uptimeSec = Math.floor((Date.now() - startedAt) / 1000);
    const m = Math.floor(uptimeSec / 60);
    const shutdownMsg = buildShutdownMessage(m);

    // 在任何异步等待之前，先为仍在运行的任务补发终态遥测事件。
    // 这样即使后续 await（通知发送、platform.stop）期间进程被第二次信号杀死，
    // ai.task.start 也有对应的 interrupted 终态，避免遥测里的 miss。
    for (const platform of successfulPlatforms) {
      const handle = activeHandles.get(platform);
      if (handle?.runningTasks && handle.runningTasks.size > 0) {
        emitInterruptedTerminals(handle.runningTasks);
      }
    }

    // Send notification only to successfully initialized platforms
    for (const platform of successfulPlatforms) {
      await sendLifecycleNotification(platform, shutdownMsg).catch((err) => {
        log.warn(`Failed to send shutdown notification to ${platform}:`, err);
      });
    }

    shutdownServer?.close();
    const portFile = join(APP_HOME, "open-im.port");
    try {
      if (existsSync(portFile)) unlinkSync(portFile);
    } catch {
      /* ignore */
    }

    // Stop each platform: abort running tasks, then handle.stop() then module.stop()
    for (const platform of successfulPlatforms) {
      const handle = activeHandles.get(platform);
      if (handle?.runningTasks) {
        for (const [key, state] of handle.runningTasks) {
          log.info(`Aborting running task ${key} on ${platform} during shutdown`);
          state.handle.abort();
        }
        handle.runningTasks.clear();
      }
      handle?.stop();
      await PLATFORM_MODULES[platform].stop();
    }

    sessionManager.destroy();
    cleanupAdapters();
    flushActiveChats();
    await shutdownLoggerTelemetry();
    await closeLogger();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown().catch(() => process.exit(1)));
  process.on("SIGTERM", () => shutdown().catch(() => process.exit(1)));

  // 兜底：进程退出（含异常路径，如未捕获异常 / SIGKILL）时强制清理 CLI 子进程，
  // 避免僵尸 / 孤儿。正常 shutdown 已在 cleanupAdapters() 里清理过。
  process.on("exit", () => {
    try {
      destroyAllLiveChildren();
    } catch {
      /* 退出期间 best effort */
    }
  });

  // Global error handlers to prevent unhandled crashes
  process.on("unhandledRejection", (reason) => {
    log.error("Unhandled Promise rejection (this indicates a bug — the affected request may hang without a response):", reason);
  });
  process.on("uncaughtException", (err) => {
    const msg = err?.message ?? String(err);
    // WebSocket "not open" errors are transient — the connection will auto-reconnect.
    // Exiting would take down all platforms, so just log and continue.
    if (msg.includes("WebSocket is not open") || msg.includes("readyState")) {
      log.debug("Transient WebSocket error (ignored, will reconnect):", err);
      return;
    }
    log.error("Uncaught exception (process will exit):", err);
    // 进程即将因未捕获异常退出：补发在途任务的终态，避免 miss
    for (const platform of successfulPlatforms) {
      const handle = activeHandles.get(platform);
      if (handle?.runningTasks && handle.runningTasks.size > 0) {
        try {
          emitInterruptedTerminals(handle.runningTasks);
        } catch {
          /* best effort：不能因遥测失败再次抛出 */
        }
      }
    }
    void shutdownLoggerTelemetry()
      .then(() => closeLogger())
      .finally(() => process.exit(1));
  });
}

const isEntry =
  process.argv[1]?.replace(/\\/g, "/").endsWith("/index.js") ||
  process.argv[1]?.replace(/\\/g, "/").endsWith("/index.ts");
if (isEntry) {
  main().catch((err) => {
    log.error("Fatal error:", err);
    void shutdownLoggerTelemetry()
      .then(() => closeLogger())
      .finally(() => process.exit(1));
  });
}
