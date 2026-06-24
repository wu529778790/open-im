// AiCommand 从 tool-definitions 派生,消除字面量联合;新增工具只改注册表一处。
import type { AiCommand } from "./tool-definitions.js";
export type { AiCommand };

export type PlatformKey = "telegram" | "feishu" | "qq" | "wework" | "dingtalk" | "workbuddy" | "clawbot";

export interface WebConfigPayload {
  platforms: {
    telegram: {
      enabled: boolean;
      aiCommand: AiCommand;
      botToken: string;
      proxy: string;
      allowedUserIds: string;
    };
    feishu: {
      enabled: boolean;
      aiCommand: AiCommand;
      appId: string;
      appSecret: string;
      allowedUserIds: string;
    };
    qq: {
      enabled: boolean;
      aiCommand: AiCommand;
      appId: string;
      secret: string;
      allowedUserIds: string;
    };
    wework: {
      enabled: boolean;
      aiCommand: AiCommand;
      corpId: string;
      secret: string;
      allowedUserIds: string;
    };
    dingtalk: {
      enabled: boolean;
      aiCommand: AiCommand;
      clientId: string;
      clientSecret: string;
      cardTemplateId: string;
      allowedUserIds: string;
    };
    workbuddy: {
      enabled: boolean;
      aiCommand: AiCommand;
      accessToken: string;
      refreshToken: string;
      userId: string;
      baseUrl: string;
      allowedUserIds: string;
    };
    clawbot: {
      enabled: boolean;
      aiCommand: AiCommand;
      apiUrl: string;
      apiToken: string;
      allowedUserIds: string;
    };
  };
  ai: {
    claudeWorkDir: string;
    claudeConfigPath: string;
    claudeProxy: string;
    claudeSkipPermissions: boolean;
    codexCliPath: string;
    codexProxy: string;
    codexApiKey?: string;
    codebuddyCliPath: string;
    opencodeCliPath: string;
    hookPort: number;
    logLevel: string;
  };
}

export interface ConfigApiResponse {
  payload: WebConfigPayload;
  meta: { configPath: string; mode: string };
}
