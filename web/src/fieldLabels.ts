import type { PlatformKey } from "./types.js";

/** i18n key for form label (t key) */
export const PLATFORM_FIELD_LABEL: Record<
  PlatformKey,
  Partial<Record<string, string>>
> = {
  telegram: {
    botToken: "botToken",
    proxy: "proxy",
    aiCommand: "platformAiTool",
    allowedUserIds: "allowedUserIds",
  },
  feishu: {
    appId: "appId",
    appSecret: "appSecret",
    aiCommand: "platformAiTool",
    allowedUserIds: "allowedUserIds",
  },
  qq: {
    appId: "qqAppId",
    secret: "qqAppSecret",
    aiCommand: "platformAiTool",
    allowedUserIds: "allowedUserIds",
  },
  wework: {
    corpId: "corpId",
    secret: "secret",
    aiCommand: "platformAiTool",
    allowedUserIds: "allowedUserIds",
  },
  dingtalk: {
    clientId: "clientId",
    clientSecret: "clientSecret",
    cardTemplateId: "cardTemplateId",
    aiCommand: "platformAiTool",
    allowedUserIds: "allowedUserIds",
  },
  workbuddy: {
    aiCommand: "platformAiTool",
    accessToken: "workbuddyAccessToken",
    refreshToken: "workbuddyRefreshToken",
    userId: "workbuddyUserId",
    baseUrl: "workbuddyBaseUrl",
    allowedUserIds: "allowedUserIds",
  },
  clawbot: {
    aiCommand: "platformAiTool",
    apiUrl: "clawbotApiUrl",
    apiToken: "clawbotApiToken",
    allowedUserIds: "allowedUserIds",
  },
};

export const PLATFORM_SUMMARY_KEY: Record<PlatformKey, string> = {
  telegram: "telegramSummary",
  feishu: "feishuSummary",
  qq: "qqSummary",
  wework: "weworkSummary",
  dingtalk: "dingtalkSummary",
  workbuddy: "workbuddySummary",
  clawbot: "clawbotSummary",
};

export const PLATFORM_HELP_KEY: Record<PlatformKey, string> = {
  telegram: "telegramHelp",
  feishu: "feishuHelp",
  qq: "qqHelp",
  wework: "weworkHelp",
  dingtalk: "dingtalkHelp",
  workbuddy: "workbuddyHelp",
  clawbot: "clawbotHelp",
};

export const INLINE_TIP_KEY: Partial<Record<`${PlatformKey}-${string}`, string>> = {
  "telegram-botToken": "tipTelegramToken",
  "feishu-appId": "tipFeishuAppId",
  "feishu-appSecret": "tipFeishuSecret",
  "qq-appId": "tipQqAppId",
  "qq-secret": "tipQqSecret",
  "wework-corpId": "tipWeworkCorp",
  "dingtalk-clientId": "tipDingtalkClient",
  "workbuddy-accessToken": "tipWorkbuddyToken",
  "clawbot-apiToken": "tipClawbotApiToken",
};
