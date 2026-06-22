import { join } from "node:path";
import { homedir, tmpdir } from "node:os";

// ─── 路径 ───

export const APP_HOME = join(homedir(), ".open-im");
export const IMAGE_DIR = join(tmpdir(), "open-im-images");

// ─── 端口 ───

/** 优雅关闭 HTTP 端口（stop 命令通过此端口触发 shutdown） */
export const SHUTDOWN_PORT = 39281;
/** 本地 Web 配置 API 固定端口 */
export const WEB_CONFIG_PORT = 39282;

function resolveWebConfigPort(): number {
  const p = process.env.OPEN_IM_WEB_PORT ? parseInt(process.env.OPEN_IM_WEB_PORT, 10) : NaN;
  return Number.isFinite(p) && p > 0 ? p : WEB_CONFIG_PORT;
}

export function getDefaultLocalDashboardUrl(): string {
  return `http://127.0.0.1:${resolveWebConfigPort()}`;
}

export function getPublicWebDashboardUrl(): string {
  const fromEnv = process.env.OPEN_IM_PUBLIC_WEB_URL?.trim();
  const raw = fromEnv || getDefaultLocalDashboardUrl();
  return raw.replace(/\/$/, "");
}

// ─── 超时（毫秒） ───

/** 服务启动就绪超时 */
export const SERVICE_READY_TIMEOUT_MS = 8_000;
/** 服务健康检查超时 */
export const HEALTH_CHECK_TIMEOUT_MS = 3_000;
/** 平台凭证测试超时 */
export const PLATFORM_TEST_TIMEOUT_MS = 10_000;
/** 版本检查超时 */
export const UPDATE_CHECK_TIMEOUT_MS = 5_000;
/** 媒体下载超时（Telegram/飞书/企业微信） */
export const MEDIA_DOWNLOAD_TIMEOUT_MS = 60_000;
/** 优雅关闭强制退出超时 */
export const SHUTDOWN_FORCE_EXIT_MS = 10_000;
/** ClawBot 长轮询单次请求超时 */
export const CLAWBOT_POLL_REQUEST_TIMEOUT_MS = 3 * 60 * 1000;
/** ClawBot watchdog 检查间隔 */
export const CLAWBOT_WATCHDOG_INTERVAL_MS = 60_000;
/** ClawBot 判定连接死亡的静默时间 */
export const CLAWBOT_WATCHDOG_STALE_MS = 5 * 60 * 1000;
/** 企业微信任务安全超时 */
export const WEWORK_TASK_SAFETY_TIMEOUT_MS = 4.5 * 60 * 1000;
/** DingTalk webhook 请求超时 */
export const DINGTALK_WEBHOOK_TIMEOUT_MS = 30_000;
/** DingTalk API 请求超时 */
export const DINGTALK_API_TIMEOUT_MS = 30_000;
/** CLI 子进程版本检测超时 */
export const CLI_VERSION_CHECK_TIMEOUT_MS = 5_000;

// ─── 重试与重连 ───

/** 企业微信最大重连尝试次数 */
export const WEWORK_MAX_RECONNECT_ATTEMPTS = 3;
/** 企业微信重连延迟 */
export const WEWORK_RECONNECT_DELAY_MS = 1_500;
/** 企业微信最大重连尝试（总） */
export const WEWORK_MAX_RECONNECT_TOTAL = 5;
/** DingTalk 429 限流重试延迟 */
export const DINGTALK_RATE_LIMIT_RETRY_MS = 60_000;
/** DingTalk 消息发送重试次数 */
export const DINGTALK_SEND_RETRIES = 1;
/** DingTalk 消息发送重试延迟 */
export const DINGTALK_SEND_RETRY_DELAY_MS = 300;
/** ClawBot 重连延迟阶梯 */
export const CLAWBOT_RECONNECT_DELAYS_MS = [3_000, 5_000, 10_000, 20_000, 30_000];
/** ClawBot 最大重连尝试 */
export const CLAWBOT_MAX_RECONNECT_ATTEMPTS = 5;

// ─── 流式与节流 ───

/** CardKit 流式更新节流：80ms */
export const CARDKIT_THROTTLE_MS = 80;
/** Telegram 编辑消息节流 */
export const TELEGRAM_THROTTLE_MS = 200;
/** 企业微信流式更新节流 */
export const WEWORK_THROTTLE_MS = 500;
/** WorkBuddy 流式更新节流 */
export const WORKBUDDY_THROTTLE_MS = 1000;
/** ClawBot 流式更新节流 */
export const CLAWBOT_THROTTLE_MS = 1000;
/** 企业微信流式发送间隔 */
export const WEWORK_STREAM_SEND_INTERVAL_MS = 900;
/** 企业微信流式清理间隔 */
export const WEWORK_STREAM_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

// ─── 消息长度限制 ───

export const MAX_TELEGRAM_MESSAGE_LENGTH = 4000;
export const MAX_FEISHU_MESSAGE_LENGTH = 4000;
export const MAX_STREAMING_CONTENT_LENGTH = 25000;
export const MAX_WEWORK_MESSAGE_LENGTH = 2048;
export const MAX_DINGTALK_MESSAGE_LENGTH = 2048;
export const MAX_WORKBUDDY_MESSAGE_LENGTH = 2000;
export const MAX_CLAWBOT_MESSAGE_LENGTH = 2000;

// ─── 轮询间隔 ───

/** ClawBot 长轮询间隔 */
export const CLAWBOT_POLL_INTERVAL_MS = 3000;

// ─── Git 共同作者 ───

export const DEFAULT_OPEN_IM_COAUTHOR_ADDR = "529778790@qq.com";

// ─── 终端独占命令 ───

export const TERMINAL_ONLY_COMMANDS = new Set([
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
