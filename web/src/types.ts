export type AiCommand = "" | "claude" | "codex" | "codebuddy";

export type PlatformKey = "telegram" | "feishu" | "qq" | "wework" | "dingtalk" | "workbuddy";

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
  };
  ai: {
    aiCommand: "claude" | "codex" | "codebuddy";
    claudeWorkDir: string;
    claudeConfigPath: string;
    claudeProxy: string;
    codexCliPath: string;
    codexProxy: string;
    codexApiKey?: string;
    codebuddyCliPath: string;
    hookPort: number;
    logLevel: string;
  };
}

export interface ConfigApiResponse {
  payload: WebConfigPayload;
  meta: { configPath: string; mode: string };
}
