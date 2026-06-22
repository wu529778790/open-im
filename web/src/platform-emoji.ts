import type { PlatformKey } from "./types.js";

/**
 * 每个 IM 平台对应的 emoji 图标。
 * 用于平台卡片折叠头左侧的视觉标识（Dashboard + SetupWizard 共用）。
 * 选择避开 🤖（已用于 AiCommandPicker 的 AI 工具语义）。
 */
export const PLATFORM_EMOJI: Record<PlatformKey, string> = {
  telegram: "✈️",
  feishu: "🐦",
  qq: "🐧",
  wework: "🏢",
  dingtalk: "📌",
  workbuddy: "🤝",
  clawbot: "💚",
};
