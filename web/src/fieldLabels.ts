import type { PlatformKey } from "./types.js";

/** Form label strings (Chinese, inline) */
export const PLATFORM_FIELD_LABEL: Record<
  PlatformKey,
  Partial<Record<string, string>>
> = {
  telegram: {
    botToken: "Bot Token",
    proxy: "代理",
    aiCommand: "平台 AI 工具覆盖",
    allowedUserIds: "允许的用户 ID",
  },
  feishu: {
    appId: "App ID",
    appSecret: "App Secret",
    aiCommand: "平台 AI 工具覆盖",
    allowedUserIds: "允许的用户 ID",
  },
  qq: {
    appId: "App ID",
    secret: "App Secret",
    aiCommand: "平台 AI 工具覆盖",
    allowedUserIds: "允许的用户 ID",
  },
  wework: {
    corpId: "Corp ID / Bot ID",
    secret: "secret",
    aiCommand: "平台 AI 工具覆盖",
    allowedUserIds: "允许的用户 ID",
  },
  dingtalk: {
    clientId: "Client ID / AppKey",
    clientSecret: "Client Secret / AppSecret",
    cardTemplateId: "卡片模板 ID",
    aiCommand: "平台 AI 工具覆盖",
    allowedUserIds: "允许的用户 ID",
  },
  workbuddy: {
    aiCommand: "平台 AI 工具覆盖",
    accessToken: "Access Token",
    refreshToken: "Refresh Token",
    userId: "User ID",
    baseUrl: "基础 URL",
    allowedUserIds: "允许的用户 ID",
  },
  clawbot: {
    aiCommand: "平台 AI 工具覆盖",
    apiUrl: "API 地址",
    apiToken: "API Token (Bearer)",
    allowedUserIds: "允许的用户 ID",
  },
};

/** Summary descriptions for each platform (Chinese) */
export const PLATFORM_SUMMARY: Record<PlatformKey, string> = {
  telegram: "Bot Token 与可选代理。",
  feishu: "App ID、App Secret 以及可访问用户范围。",
  qq: "QQ 机器人 App ID 与 Secret。",
  wework: "企业微信 Corp ID 与 Secret。",
  dingtalk: "钉钉 Client 凭证，可选配置卡片模板 ID。",
  workbuddy: "通过 CodeBuddy OAuth 连接微信助理。",
  clawbot: "通过 ClawBot 连接微信客服号。",
};

/** Help HTML strings for each platform */
export const PLATFORM_HELP_HTML: Record<PlatformKey, string> = {
  telegram: "获取凭证：访问 <a href=\"https://t.me/BotFather\" target=\"_blank\">@BotFather</a>，发送 /newbot 创建机器人并拿到 Bot Token",
  feishu: "获取凭证：访问 <a href=\"https://open.feishu.cn/\" target=\"_blank\">飞书开放平台</a>，创建应用、启用机器人并拿到 App ID / App Secret",
  qq: "获取凭证：访问 <a href=\"https://bot.q.qq.com\" target=\"_blank\">QQ 开放平台</a>，创建机器人并拿到 App ID / App Secret",
  wework: "获取凭证：访问 <a href=\"https://work.weixin.qq.com/\" target=\"_blank\">企业微信管理后台</a>，创建应用并拿到 Bot ID（Corp ID）/ Secret",
  dingtalk: "获取凭证：在 <a href=\"https://open-dev.dingtalk.com/\" target=\"_blank\">钉钉开放平台</a> 创建企业内部应用，启用 Stream Mode，并拿到 Client ID / Client Secret",
  workbuddy: "获取凭证：通过 CodeBuddy OAuth 登录获取 access/refresh token。WorkBuddy 通过 Centrifuge WebSocket 连接微信客服。",
  clawbot: "点击“扫码登录”通过微信认证，或手动粘贴 Token。",
};

/** Inline tip HTML for specific platform+field combinations */
export const INLINE_TIP_HTML: Partial<Record<`${PlatformKey}-${string}`, string>> = {
  "telegram-botToken": "在 Telegram 搜 <a href=\"https://t.me/BotFather\" target=\"_blank\" rel=\"noopener\">@BotFather</a>，发 /newbot 创建机器人后复制 Token。",
  "feishu-appId": "飞书开放平台 → 应用 → 凭证与基础信息 → App ID。",
  "feishu-appSecret": "同一页 App Secret（可重置后查看）。",
  "qq-appId": "<a href=\"https://bot.q.qq.com\" target=\"_blank\" rel=\"noopener\">QQ 开放平台</a> → 机器人 → App ID。",
  "qq-secret": "同一处获取 App Secret。",
  "wework-corpId": "企业微信管理后台 → 应用 → 查省 Corp ID / 智能机器人 Bot ID 与 Secret。",
  "dingtalk-clientId": "<a href=\"https://open-dev.dingtalk.com\" target=\"_blank\" rel=\"noopener\">钉钉开放平台</a> → 企业内部应用 → AppKey / AppSecret。",
  "workbuddy-accessToken": "前往“AI 工具配置”或使用设置向导配置 WorkBuddy OAuth；或粘贴 CodeBuddy 登录后的 Token。",
  "clawbot-apiToken": "使用平台卡片中的“扫码登录”按钮，或从 ClawBot iLink 登录后复制 Token。",
};