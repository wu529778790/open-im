import type { FileConfig } from "./config.js";

export function getHealthPlatformSnapshot(
  file: FileConfig,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, { configured: boolean; enabled: boolean; healthy: boolean; message?: string }> {
  const fileTelegram = file.platforms?.telegram;
  const fileFeishu = file.platforms?.feishu;
  const fileQQ = file.platforms?.qq;
  const fileWework = file.platforms?.wework;
  const fileDingtalk = file.platforms?.dingtalk;
  const fileWorkbuddy = file.platforms?.workbuddy;
  const fileClawbot = file.platforms?.clawbot;
  const telegramBotToken = env.TELEGRAM_BOT_TOKEN ?? fileTelegram?.botToken ?? file.telegramBotToken;
  const feishuAppId = env.FEISHU_APP_ID ?? fileFeishu?.appId ?? file.feishuAppId;
  const feishuAppSecret = env.FEISHU_APP_SECRET ?? fileFeishu?.appSecret ?? file.feishuAppSecret;
  const qqAppId = env.QQ_BOT_APPID ?? env.QQ_APP_ID ?? fileQQ?.appId;
  const qqSecret = env.QQ_BOT_SECRET ?? env.QQ_SECRET ?? fileQQ?.secret;
  const weworkCorpId = env.WEWORK_CORP_ID ?? fileWework?.corpId;
  const weworkSecret = env.WEWORK_SECRET ?? fileWework?.secret;
  const dingtalkClientId = env.DINGTALK_CLIENT_ID ?? fileDingtalk?.clientId;
  const dingtalkClientSecret = env.DINGTALK_CLIENT_SECRET ?? fileDingtalk?.clientSecret;
  const workbuddyAccessToken = fileWorkbuddy?.accessToken;
  const workbuddyRefreshToken = fileWorkbuddy?.refreshToken;
  const workbuddyUserId = fileWorkbuddy?.userId;

  return {
    telegram: {
      configured: !!telegramBotToken,
      enabled: !!telegramBotToken && fileTelegram?.enabled !== false,
      healthy: !!telegramBotToken,
      message: telegramBotToken ? "Token configured" : "Token not configured",
    },
    feishu: {
      configured: !!(feishuAppId && feishuAppSecret),
      enabled: !!(feishuAppId && feishuAppSecret) && fileFeishu?.enabled !== false,
      healthy: !!(feishuAppId && feishuAppSecret),
      message: feishuAppId && feishuAppSecret ? "App ID and Secret configured" : "Missing credentials",
    },
    qq: {
      configured: !!(qqAppId && qqSecret),
      enabled: !!(qqAppId && qqSecret) && fileQQ?.enabled !== false,
      healthy: !!(qqAppId && qqSecret),
      message: qqAppId && qqSecret ? "App ID and Secret configured" : "Missing credentials",
    },
    wework: {
      configured: !!(weworkCorpId && weworkSecret),
      enabled: !!(weworkCorpId && weworkSecret) && fileWework?.enabled !== false,
      healthy: !!(weworkCorpId && weworkSecret),
      message: weworkCorpId && weworkSecret ? "Corp ID and Secret configured" : "Missing credentials",
    },
    dingtalk: {
      configured: !!(dingtalkClientId && dingtalkClientSecret),
      enabled: !!(dingtalkClientId && dingtalkClientSecret) && fileDingtalk?.enabled !== false,
      healthy: !!(dingtalkClientId && dingtalkClientSecret),
      message: dingtalkClientId && dingtalkClientSecret ? "Client ID and Secret configured" : "Missing credentials",
    },
    workbuddy: {
      configured: !!(workbuddyAccessToken && workbuddyRefreshToken && workbuddyUserId),
      enabled: !!(workbuddyAccessToken && workbuddyRefreshToken && workbuddyUserId) && fileWorkbuddy?.enabled !== false,
      healthy: !!(workbuddyAccessToken && workbuddyRefreshToken && workbuddyUserId),
      message: workbuddyAccessToken && workbuddyRefreshToken && workbuddyUserId ? "OAuth credentials configured" : "Missing credentials",
    },
    clawbot: {
      configured: !!fileClawbot?.apiToken,
      enabled: !!fileClawbot?.apiToken && fileClawbot?.enabled !== false,
      healthy: !!fileClawbot?.apiToken,
      message: fileClawbot?.apiToken ? "API Token configured" : "Missing API Token",
    },
  };
}
