import type { WebConfigPayload } from "./types.js";

/**
 * 空 WebConfigPayload 工厂。Dashboard 与 SetupWizard 共用,避免两份副本漂移
 * (此前 opencodeCliPath 字段只在一边存在)。
 */
export function emptyPayload(): WebConfigPayload {
  return {
    platforms: {
      telegram: { enabled: false, aiCommand: "claude", botToken: "", proxy: "", allowedUserIds: "" },
      feishu: { enabled: false, aiCommand: "claude", appId: "", appSecret: "", allowedUserIds: "" },
      qq: { enabled: false, aiCommand: "claude", appId: "", secret: "", allowedUserIds: "" },
      wework: { enabled: false, aiCommand: "claude", corpId: "", secret: "", allowedUserIds: "" },
      dingtalk: { enabled: false, aiCommand: "claude", clientId: "", clientSecret: "", cardTemplateId: "", allowedUserIds: "" },
      workbuddy: { enabled: false, aiCommand: "claude", accessToken: "", refreshToken: "", userId: "", baseUrl: "", allowedUserIds: "" },
      clawbot: { enabled: false, aiCommand: "claude", apiUrl: "http://127.0.0.1:26322", apiToken: "", allowedUserIds: "" },
    },
    ai: {
      claudeWorkDir: "",
      claudeConfigPath: "",
      claudeProxy: "",
      codexCliPath: "codex",
      codexProxy: "",
      codebuddyCliPath: "codebuddy",
      opencodeCliPath: "opencode",
      hookPort: 0,
      logLevel: "default",
    },
  };
}
