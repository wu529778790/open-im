import { readFileSync, existsSync } from "node:fs";
import {
  getClaudeConfigHome,
  loadClaudeSettingsEnv,
  saveClaudeSettingsEnv,
  normalizeAiCommand,
  type FileConfig,
  CODEX_AUTH_PATHS,
} from "./config.js";
import { splitCsv } from "./config-web-cors.js";
import type { AiCommand } from "./adapters/tool-registry.js";

/** 前端 aiCommand 可为空字符串(未选择态);保存时经 persistedPlatformAi 规范化 */
export type WebAiCommand = AiCommand | "";

export interface WebConfigPayload {
  platforms: {
    telegram: { enabled: boolean; aiCommand: WebAiCommand; botToken: string; proxy: string; allowedUserIds: string };
    feishu: { enabled: boolean; aiCommand: WebAiCommand; appId: string; appSecret: string; allowedUserIds: string };
    qq: { enabled: boolean; aiCommand: WebAiCommand; appId: string; secret: string; allowedUserIds: string };
    wework: { enabled: boolean; aiCommand: WebAiCommand; corpId: string; secret: string; allowedUserIds: string };
    dingtalk: { enabled: boolean; aiCommand: WebAiCommand; clientId: string; clientSecret: string; cardTemplateId: string; allowedUserIds: string };
    workbuddy: { enabled: boolean; aiCommand: WebAiCommand; accessToken: string; refreshToken: string; userId: string; baseUrl: string; allowedUserIds: string };
    clawbot: { enabled: boolean; aiCommand: WebAiCommand; apiUrl: string; apiToken: string; allowedUserIds: string };
  };
  ai: {
    claudeWorkDir: string;
    claudeConfigPath: string;
    claudeAuthToken: string;
    claudeBaseUrl: string;
    claudeModel: string;
    claudeProxy: string;
    claudeSkipPermissions: boolean;
    codexCliPath: string;
    codebuddyCliPath: string;
    opencodeCliPath: string;
    codexProxy: string;
    codexApiKey?: string;
    logDir?: string;
    logLevel: "default" | "DEBUG" | "INFO" | "WARN" | "ERROR";
  };
}

export function clean(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function persistedPlatformAi(v: string | undefined): AiCommand {
  // 经 registry 规范化;此前硬编码只认 codex/codebuddy/claude,会把 opencode 降级为 claude。
  return normalizeAiCommand(clean(v), "claude");
}

export function isMasked(value: string | undefined): boolean {
  return typeof value === "string" && value.includes("****");
}

/** 如果前端传回的是掩码值（包含 ****），保留 existing 中的真实密钥，避免覆盖 */
export function resolveSecret(incoming: string | undefined, existing: string | undefined): string | undefined {
  if (isMasked(incoming)) return existing;
  return clean(incoming);
}

export function maskSecret(value: string | undefined): string {
  if (!value || value.length <= 4) return value ? "****" : "";
  return value.slice(0, 2) + "****" + value.slice(-2);
}

export function buildInitialPayload(file: FileConfig): WebConfigPayload {
  // Load Claude settings from ~/.claude/settings.json
  const claudeEnv = loadClaudeSettingsEnv();

  return {
    platforms: {
      telegram: {
        enabled: file.platforms?.telegram?.enabled ?? Boolean(file.platforms?.telegram?.botToken),
        aiCommand: normalizeAiCommand(file.platforms?.telegram?.aiCommand, "claude"),
        botToken: maskSecret(file.platforms?.telegram?.botToken),
        proxy: file.platforms?.telegram?.proxy ?? "",
        allowedUserIds: (file.platforms?.telegram?.allowedUserIds ?? []).join(", "),
      },
      feishu: {
        enabled: file.platforms?.feishu?.enabled ?? Boolean(file.platforms?.feishu?.appId && file.platforms?.feishu?.appSecret),
        aiCommand: normalizeAiCommand(file.platforms?.feishu?.aiCommand, "claude"),
        appId: file.platforms?.feishu?.appId ?? "",
        appSecret: maskSecret(file.platforms?.feishu?.appSecret),
        allowedUserIds: (file.platforms?.feishu?.allowedUserIds ?? []).join(", "),
      },
      qq: {
        enabled: file.platforms?.qq?.enabled ?? Boolean(file.platforms?.qq?.appId && file.platforms?.qq?.secret),
        aiCommand: normalizeAiCommand(file.platforms?.qq?.aiCommand, "claude"),
        appId: file.platforms?.qq?.appId ?? "",
        secret: maskSecret(file.platforms?.qq?.secret),
        allowedUserIds: (file.platforms?.qq?.allowedUserIds ?? []).join(", "),
      },
      wework: {
        enabled: file.platforms?.wework?.enabled ?? Boolean(file.platforms?.wework?.corpId && file.platforms?.wework?.secret),
        aiCommand: normalizeAiCommand(file.platforms?.wework?.aiCommand, "claude"),
        corpId: file.platforms?.wework?.corpId ?? "",
        secret: maskSecret(file.platforms?.wework?.secret),
        allowedUserIds: (file.platforms?.wework?.allowedUserIds ?? []).join(", "),
      },
      dingtalk: {
        enabled: file.platforms?.dingtalk?.enabled ?? Boolean(file.platforms?.dingtalk?.clientId && file.platforms?.dingtalk?.clientSecret),
        aiCommand: normalizeAiCommand(file.platforms?.dingtalk?.aiCommand, "claude"),
        clientId: file.platforms?.dingtalk?.clientId ?? "",
        clientSecret: maskSecret(file.platforms?.dingtalk?.clientSecret),
        cardTemplateId: file.platforms?.dingtalk?.cardTemplateId ?? "",
        allowedUserIds: (file.platforms?.dingtalk?.allowedUserIds ?? []).join(", "),
      },
      workbuddy: {
        enabled: file.platforms?.workbuddy?.enabled ?? Boolean(file.platforms?.workbuddy?.accessToken && file.platforms?.workbuddy?.refreshToken && file.platforms?.workbuddy?.userId),
        aiCommand: normalizeAiCommand(file.platforms?.workbuddy?.aiCommand, "claude"),
        accessToken: maskSecret(file.platforms?.workbuddy?.accessToken),
        refreshToken: maskSecret(file.platforms?.workbuddy?.refreshToken),
        userId: file.platforms?.workbuddy?.userId ?? "",
        baseUrl: file.platforms?.workbuddy?.baseUrl ?? "",
        allowedUserIds: (file.platforms?.workbuddy?.allowedUserIds ?? []).join(", "),
      },
      clawbot: {
        enabled: file.platforms?.clawbot?.enabled ?? Boolean(file.platforms?.clawbot?.apiToken),
        aiCommand: normalizeAiCommand(file.platforms?.clawbot?.aiCommand, "claude"),
        apiUrl: file.platforms?.clawbot?.apiUrl ?? "http://127.0.0.1:26322",
        apiToken: maskSecret(file.platforms?.clawbot?.apiToken),
        allowedUserIds: (file.platforms?.clawbot?.allowedUserIds ?? []).join(", "),
      },
    },
    ai: {
      claudeWorkDir: file.tools?.claude?.workDir ?? process.cwd(),
      claudeConfigPath: process.platform === 'win32'
        ? getClaudeConfigHome() + "\\.claude\\settings.json"
        : getClaudeConfigHome() + "/.claude/settings.json",
      claudeAuthToken: maskSecret(claudeEnv.ANTHROPIC_AUTH_TOKEN),
      claudeBaseUrl: claudeEnv.ANTHROPIC_BASE_URL ?? "",
      claudeModel: claudeEnv.ANTHROPIC_MODEL ?? "",
      claudeProxy: file.tools?.claude?.proxy ?? "",
      claudeSkipPermissions: file.tools?.claude?.skipPermissions ?? false,
      codexCliPath: file.tools?.codex?.cliPath ?? "codex",
      codebuddyCliPath: file.tools?.codebuddy?.cliPath ?? "codebuddy",
      opencodeCliPath: file.tools?.opencode?.cliPath ?? "opencode",
      codexProxy: file.tools?.codex?.proxy ?? "",
      codexApiKey: (() => {
        if (process.env.OPENAI_API_KEY) return maskSecret(process.env.OPENAI_API_KEY);
        for (const p of CODEX_AUTH_PATHS) {
          try {
            if (existsSync(p)) {
              const raw = JSON.parse(readFileSync(p, "utf-8"));
              const key = raw?.openai_api_key ?? raw?.apiKey;
              if (typeof key === "string" && key) return maskSecret(key);
            }
          } catch { /* ignore */ }
        }
        return "";
      })(),
      logDir: file.logDir ?? "",
      logLevel: (file.logLevel as "DEBUG" | "INFO" | "WARN" | "ERROR") ?? "default",
    },
  };
}

export function validatePayload(payload: WebConfigPayload): string[] {
  const errors: string[] = [];
  const enabledCount = Object.values(payload.platforms).filter((item) => item.enabled).length;
  if (enabledCount === 0) errors.push("At least one platform must be enabled.");
  if (payload.platforms.telegram.enabled && !clean(payload.platforms.telegram.botToken)) errors.push("Telegram bot token is required.");
  if (payload.platforms.feishu.enabled && !clean(payload.platforms.feishu.appId)) errors.push("Feishu app ID is required.");
  if (payload.platforms.feishu.enabled && !clean(payload.platforms.feishu.appSecret)) errors.push("Feishu app secret is required.");
  if (payload.platforms.qq.enabled && !clean(payload.platforms.qq.appId)) errors.push("QQ app ID is required.");
  if (payload.platforms.qq.enabled && !clean(payload.platforms.qq.secret)) errors.push("QQ app secret is required.");
  if (payload.platforms.wework.enabled && !clean(payload.platforms.wework.corpId)) errors.push("WeWork corp ID is required.");
  if (payload.platforms.wework.enabled && !clean(payload.platforms.wework.secret)) errors.push("WeWork secret is required.");
  if (payload.platforms.dingtalk.enabled && !clean(payload.platforms.dingtalk.clientId)) errors.push("DingTalk client ID is required.");
  if (payload.platforms.dingtalk.enabled && !clean(payload.platforms.dingtalk.clientSecret)) errors.push("DingTalk client secret is required.");
  if (payload.platforms.workbuddy.enabled && !clean(payload.platforms.workbuddy.accessToken)) errors.push("WorkBuddy access token is required.");
  if (payload.platforms.workbuddy.enabled && !clean(payload.platforms.workbuddy.refreshToken)) errors.push("WorkBuddy refresh token is required.");
  if (payload.platforms.workbuddy.enabled && !clean(payload.platforms.workbuddy.userId)) errors.push("WorkBuddy user ID is required.");
  if (payload.platforms.clawbot.enabled && !clean(payload.platforms.clawbot.apiToken)) errors.push("ClawBot API token is required.");
  if (!clean(payload.ai.claudeWorkDir)) errors.push("Default work directory is required.");
  return errors;
}

export function toFileConfig(payload: WebConfigPayload, existing: FileConfig): FileConfig {
  // Save Claude environment variables to ~/.claude/settings.json
  const claudeEnv: Record<string, string> = {};
  const existingClaudeEnv = loadClaudeSettingsEnv();
  const resolvedAuthToken = resolveSecret(payload.ai.claudeAuthToken, existingClaudeEnv.ANTHROPIC_AUTH_TOKEN);
  if (resolvedAuthToken) claudeEnv.ANTHROPIC_AUTH_TOKEN = resolvedAuthToken;
  if (payload.ai.claudeBaseUrl) claudeEnv.ANTHROPIC_BASE_URL = payload.ai.claudeBaseUrl;
  if (payload.ai.claudeModel) claudeEnv.ANTHROPIC_MODEL = payload.ai.claudeModel;
  if (Object.keys(claudeEnv).length > 0) {
    saveClaudeSettingsEnv(claudeEnv);
  }
  // claudeConfigPath is informational only, not saved
  const { env: _discardLegacyRootEnv, aiCommand: _discardLegacyGlobalAi, ...existingWithoutRootEnv } = existing as FileConfig & {
    env?: Record<string, string>;
  };

  return {
    ...existingWithoutRootEnv,
    logDir: payload.ai.logDir === undefined ? existing.logDir : clean(payload.ai.logDir),
    logLevel: payload.ai.logLevel === "default" ? undefined : payload.ai.logLevel,
    tools: {
      claude: {
        ...existing.tools?.claude,
        workDir: clean(payload.ai.claudeWorkDir) ?? process.cwd(),
        proxy: clean(payload.ai.claudeProxy),
        skipPermissions: payload.ai.claudeSkipPermissions,
        // model is now saved to ~/.claude/settings.json as env var
      },
      codex: {
        ...existing.tools?.codex,
        cliPath: clean(payload.ai.codexCliPath) ?? "codex",
        workDir: clean(payload.ai.claudeWorkDir) ?? process.cwd(),
        proxy: clean(payload.ai.codexProxy),
      },
      codebuddy: {
        ...existing.tools?.codebuddy,
        cliPath: clean(payload.ai.codebuddyCliPath) ?? "codebuddy",
      },
      opencode: {
        ...existing.tools?.opencode,
        cliPath: clean(payload.ai.opencodeCliPath) ?? "opencode",
      },
    },
    platforms: {
      ...existing.platforms,
      telegram: {
        ...existing.platforms?.telegram,
        enabled: payload.platforms.telegram.enabled,
        aiCommand: persistedPlatformAi(payload.platforms.telegram.aiCommand),
        botToken: resolveSecret(payload.platforms.telegram.botToken, existing.platforms?.telegram?.botToken),
        proxy: clean(payload.platforms.telegram.proxy),
        allowedUserIds: splitCsv(payload.platforms.telegram.allowedUserIds),
      },
      feishu: {
        ...existing.platforms?.feishu,
        enabled: payload.platforms.feishu.enabled,
        aiCommand: persistedPlatformAi(payload.platforms.feishu.aiCommand),
        appId: clean(payload.platforms.feishu.appId),
        appSecret: resolveSecret(payload.platforms.feishu.appSecret, existing.platforms?.feishu?.appSecret),
        allowedUserIds: splitCsv(payload.platforms.feishu.allowedUserIds),
      },
      qq: {
        ...existing.platforms?.qq,
        enabled: payload.platforms.qq.enabled,
        aiCommand: persistedPlatformAi(payload.platforms.qq.aiCommand),
        appId: clean(payload.platforms.qq.appId),
        secret: resolveSecret(payload.platforms.qq.secret, existing.platforms?.qq?.secret),
        allowedUserIds: splitCsv(payload.platforms.qq.allowedUserIds),
      },
      wework: {
        ...existing.platforms?.wework,
        enabled: payload.platforms.wework.enabled,
        aiCommand: persistedPlatformAi(payload.platforms.wework.aiCommand),
        corpId: clean(payload.platforms.wework.corpId),
        secret: resolveSecret(payload.platforms.wework.secret, existing.platforms?.wework?.secret),
        allowedUserIds: splitCsv(payload.platforms.wework.allowedUserIds),
      },
      dingtalk: {
        ...existing.platforms?.dingtalk,
        enabled: payload.platforms.dingtalk.enabled,
        aiCommand: persistedPlatformAi(payload.platforms.dingtalk.aiCommand),
        clientId: clean(payload.platforms.dingtalk.clientId),
        clientSecret: resolveSecret(payload.platforms.dingtalk.clientSecret, existing.platforms?.dingtalk?.clientSecret),
        cardTemplateId: clean(payload.platforms.dingtalk.cardTemplateId),
        allowedUserIds: splitCsv(payload.platforms.dingtalk.allowedUserIds),
      },
      workbuddy: {
        ...existing.platforms?.workbuddy,
        enabled: payload.platforms.workbuddy.enabled,
        aiCommand: persistedPlatformAi(payload.platforms.workbuddy.aiCommand),
        accessToken: resolveSecret(payload.platforms.workbuddy.accessToken, existing.platforms?.workbuddy?.accessToken),
        refreshToken: resolveSecret(payload.platforms.workbuddy.refreshToken, existing.platforms?.workbuddy?.refreshToken),
        userId: clean(payload.platforms.workbuddy.userId),
        baseUrl: clean(payload.platforms.workbuddy.baseUrl),
        allowedUserIds: splitCsv(payload.platforms.workbuddy.allowedUserIds),
      },
      clawbot: {
        ...existing.platforms?.clawbot,
        enabled: payload.platforms.clawbot.enabled,
        aiCommand: persistedPlatformAi(payload.platforms.clawbot.aiCommand),
        apiUrl: clean(payload.platforms.clawbot.apiUrl) ?? "http://127.0.0.1:26322",
        apiToken: resolveSecret(payload.platforms.clawbot.apiToken, existing.platforms?.clawbot?.apiToken),
        allowedUserIds: splitCsv(payload.platforms.clawbot.allowedUserIds),
      },
    },
  };
}
