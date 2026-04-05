import { join } from "node:path";
import { homedir, tmpdir } from "node:os";

export const APP_HOME = join(homedir(), ".open-im");
/** 优雅关闭 HTTP 端口（stop 命令通过此端口触发 shutdown） */
export const SHUTDOWN_PORT = 39281;
/** 本地 Web 配置 API 固定端口（完整 UI 见线上控制台，见 getPublicWebDashboardUrl） */
export const WEB_CONFIG_PORT = 39282;

/** 默认线上 Web 控制台（npm 包不再内置大段 HTML；可通过 OPEN_IM_PUBLIC_WEB_URL 覆盖） */
export const PUBLIC_WEB_DASHBOARD_DEFAULT = "https://open-im.shenzjd.com";

export function getPublicWebDashboardUrl(): string {
  const fromEnv = process.env.OPEN_IM_PUBLIC_WEB_URL?.trim();
  const raw = fromEnv || PUBLIC_WEB_DASHBOARD_DEFAULT;
  return raw.replace(/\/$/, "");
}
export const IMAGE_DIR = join(tmpdir(), "open-im-images");

export const TERMINAL_ONLY_COMMANDS = new Set([
  "/context",
  "/rewind",
  "/copy",
  "/export",
  "/config",
  "/init",
  "/memory",
  "/permissions",
  "/theme",
  "/vim",
  "/statusline",
  "/terminal-setup",
  "/debug",
  "/tasks",
  "/mcp",
  "/teleport",
  "/add-dir",
]);

/** CardKit 流式更新节流：80ms（约 12 次/秒，cardElement.content 专为打字机设计，支持更高频率） */
export const CARDKIT_THROTTLE_MS = 80;
/** Telegram 编辑消息节流：200ms（open-im 默认值） */
export const TELEGRAM_THROTTLE_MS = 200;
/** WorkBuddy 流式更新节流：1000ms（Centrifuge 协议建议值） */
export const WORKBUDDY_THROTTLE_MS = 1000;
export const WEWORK_THROTTLE_MS = 500;
export const MAX_TELEGRAM_MESSAGE_LENGTH = 4000;
export const MAX_FEISHU_MESSAGE_LENGTH = 4000;
/** CardKit 流式内容最大长度（卡片上限约 30KB，留余量） */
export const MAX_STREAMING_CONTENT_LENGTH = 25000;
export const MAX_WEWORK_MESSAGE_LENGTH = 2048;
export const MAX_DINGTALK_MESSAGE_LENGTH = 2048;
