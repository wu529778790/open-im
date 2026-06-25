import { Telegraf } from "telegraf";
import type { Config } from "../config.js";
import { createLogger } from "../logger.js";
import { isFatalReconnectError, jitteredDelay } from "../shared/reconnect.js";

const log = createLogger("Telegram");

let bot: Telegraf;

export function getBot(): Telegraf {
  if (!bot) throw new Error("Telegram bot not initialized");
  return bot;
}

export async function initTelegram(
  config: Config,
  setupHandlers: (bot: Telegraf) => void,
): Promise<void> {
  const token = config.telegramBotToken ?? "";
  if (!token) {
    throw new Error("Telegram bot token is required");
  }
  bot = new Telegraf(token);
  setupHandlers(bot);
  await bot.telegram.getMe();

  const launchWithRetry = async (attempt = 1): Promise<void> => {
    try {
      await bot.launch();
    } catch (err) {
      log.error("Telegram polling error:", err);
      try {
        bot.stop("Telegram polling error");
      } catch {
        /* ignore */
      }
      // 致命错误（token 无效等）：不再重试，避免烧满 10 次
      if (isFatalReconnectError(err)) {
        log.error("Telegram 致命错误，停止重连（请检查 bot token）:", err);
        return;
      }
      const maxAttempts = 10;
      const delayMs = jitteredDelay(Math.min(5000 * attempt, 60000));
      if (attempt < maxAttempts) {
        log.info(`Telegram reconnect in ${Math.round(delayMs / 1000)}s (attempt ${attempt}/${maxAttempts})`);
        await new Promise((r) => setTimeout(r, delayMs));
        return launchWithRetry(attempt + 1);
      }
      log.error("Telegram gave up reconnecting, skipping");
      // 不再 exit(1)，让其他通道继续运行
    }
  };
  void launchWithRetry().catch((err) => {
    log.error("Telegram launchWithRetry failed fatally:", err);
  });
  log.info("Telegram bot launched");
}

export function stopTelegram(): void {
  bot?.stop("SIGTERM");
}
