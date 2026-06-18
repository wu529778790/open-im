import type { PlatformKey } from "./types.js";

export const STORAGE_KEY_LANG = "open-im-web-lang";
export const STORAGE_KEY_DARK_MODE = "open-im-web-dark-mode";
export const STORAGE_KEY_SERVER = "open-im-web-api-base";

/** 本地 Web 配置 API（与 open-im 默认端口一致） */
export const DEFAULT_SERVER_URL = "http://127.0.0.1:39282";

export const POLLING_INTERVAL_MS = 10_000;

export const PLATFORM_KEYS: PlatformKey[] = [
  "telegram",
  "feishu",
  "qq",
  "wework",
  "dingtalk",
  "workbuddy",
  "clawbot",
];

export const PLATFORM_DEFINITIONS = [
  {
    key: "telegram" as const,
    label: "Telegram",
    fields: ["aiCommand", "botToken", "proxy", "allowedUserIds"] as const,
    testFields: ["botToken", "proxy"] as const,
    requiredFields: ["botToken"] as const,
    sensitiveFields: ["botToken"] as const,
    docUrl: "https://core.telegram.org/bots#creating-a-new-bot",
    docLabel: "Telegram Bot 文档",
  },
  {
    key: "feishu" as const,
    label: "Feishu",
    fields: ["aiCommand", "appId", "appSecret", "allowedUserIds"] as const,
    testFields: ["appId", "appSecret"] as const,
    requiredFields: ["appId", "appSecret"] as const,
    sensitiveFields: ["appSecret"] as const,
    docUrl: "https://open.feishu.cn/document/home/develop-a-bot-in-5-minutes/create-an-app",
    docLabel: "飞书开放平台",
  },
  {
    key: "qq" as const,
    label: "QQ",
    fields: ["aiCommand", "appId", "secret", "allowedUserIds"] as const,
    testFields: ["appId", "secret"] as const,
    requiredFields: ["appId", "secret"] as const,
    sensitiveFields: ["secret"] as const,
    docUrl: "https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/api.html",
    docLabel: "QQ 开放平台",
  },
  {
    key: "wework" as const,
    label: "WeWork",
    fields: ["aiCommand", "corpId", "secret", "allowedUserIds"] as const,
    testFields: ["corpId", "secret"] as const,
    requiredFields: ["corpId", "secret"] as const,
    sensitiveFields: ["secret"] as const,
    docUrl: "https://developer.work.weixin.qq.com/document/path/90665",
    docLabel: "企业微信管理后台",
  },
  {
    key: "dingtalk" as const,
    label: "DingTalk",
    fields: ["aiCommand", "clientId", "clientSecret", "cardTemplateId", "allowedUserIds"] as const,
    testFields: ["clientId", "clientSecret"] as const,
    requiredFields: ["clientId", "clientSecret"] as const,
    sensitiveFields: ["clientSecret"] as const,
    docUrl: "https://open-dev.dingtalk.com/",
    docLabel: "钉钉开放平台",
  },
  {
    key: "workbuddy" as const,
    label: "WorkBuddy",
    fields: ["aiCommand", "accessToken", "refreshToken", "userId", "baseUrl", "allowedUserIds"] as const,
    testFields: ["accessToken", "refreshToken", "userId"] as const,
    requiredFields: ["accessToken", "refreshToken", "userId"] as const,
    sensitiveFields: ["accessToken", "refreshToken"] as const,
    docUrl: "https://www.codebuddy.cn/docs/workbuddy/Claw",
    docLabel: "WorkBuddy 接入指南",
  },
  {
    key: "clawbot" as const,
    label: "ClawBot",
    fields: ["aiCommand", "apiUrl", "apiToken", "allowedUserIds"] as const,
    testFields: ["apiUrl", "apiToken"] as const,
    requiredFields: ["apiToken"] as const,
    sensitiveFields: ["apiToken"] as const,
    docUrl: "https://www.codebuddy.cn/docs/workbuddy/Claw",
    docLabel: "ClawBot 接入指南",
  },
];
