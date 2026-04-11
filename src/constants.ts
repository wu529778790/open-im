import { join } from "node:path";
import { homedir, tmpdir } from "node:os";

export const APP_HOME = join(homedir(), ".open-im");

/**
 * 未设置 `OPEN_IM_TELEMETRY_URL` / `telemetry.url` 时使用的默认采集端（HTTPS）。
 * 工具发行方可写死自有域名；留空字符串则仅在上游显式配置 URL 时上传。
 */
export const DEFAULT_TELEMETRY_INGEST_URL = "https://open-im.shenzjd.com/v1/ingest";

/**
 * 未设置 `OPEN_IM_TELEMETRY_TOKEN` / `telemetry.token` 时使用的默认 Bearer。
 * 须与 Cloudflare Worker 的 `wrangler secret put TELEMETRY_INGEST_TOKEN` 值完全一致。
 */
export const DEFAULT_TELEMETRY_INGEST_TOKEN =
  "610457d55274f20f2d031d38cdfd86c8498016e75160f60cdbce0dab93a78240";

/** 优雅关闭 HTTP 端口（stop 命令通过此端口触发 shutdown） */
export const SHUTDOWN_PORT = 39281;
/** 本地 Web 配置 API 固定端口（完整 UI 由 web/dist 随包提供，见 getPublicWebDashboardUrl） */
export const WEB_CONFIG_PORT = 39282;

function resolveWebConfigPort(): number {
  const p = process.env.OPEN_IM_WEB_PORT ? parseInt(process.env.OPEN_IM_WEB_PORT, 10) : NaN;
  return Number.isFinite(p) && p > 0 ? p : WEB_CONFIG_PORT;
}

/** 本机仪表盘默认 URL（与内置 SPA 同源；可通过 OPEN_IM_PUBLIC_WEB_URL 覆盖为自定义地址） */
export function getDefaultLocalDashboardUrl(): string {
  return `http://127.0.0.1:${resolveWebConfigPort()}`;
}

export function getPublicWebDashboardUrl(): string {
  const fromEnv = process.env.OPEN_IM_PUBLIC_WEB_URL?.trim();
  const raw = fromEnv || getDefaultLocalDashboardUrl();
  return raw.replace(/\/$/, "");
}
export const IMAGE_DIR = join(tmpdir(), "open-im-images");

/**
 * Co-authored-by 使用的固定提交者地址（开箱即用，形如 GitHub noreply）。
 * 若希望贡献图关联到具体用户，请将该地址加入对应 GitHub 账号的已验证联系方式，或 fork 后自行修改常量。
 */
export const DEFAULT_OPEN_IM_COAUTHOR_ADDR = "529778790@qq.com";

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
/** WeChat KF (微信客服) 单条消息最大字符数 */
export const MAX_WORKBUDDY_MESSAGE_LENGTH = 2000;
