import { DWClient } from "dingtalk-stream";
import type { Config } from "./config.js";
import { PLATFORM_TEST_TIMEOUT_MS } from "./constants.js";
import { initWeWork, stopWeWork } from "./wework/client.js";
import { clean } from "./config-web-payload.js";

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Unexpected non-JSON response: ${text.slice(0, 200)}`);
  }
}

function createProbeConfig(values: Partial<Config>): Config {
  return {
    enabledPlatforms: [],
    allowedUserIds: [],
    telegramAllowedUserIds: [],
    feishuAllowedUserIds: [],
    qqAllowedUserIds: [],
    weworkAllowedUserIds: [],
    dingtalkAllowedUserIds: [],
    workbuddyAllowedUserIds: [],
    clawbotAllowedUserIds: [],
    codexCliPath: "codex",
    claudeWorkDir: process.cwd(),
    claudeSessionIdleTtlMinutes: 30,
    logDir: "",
    logLevel: "INFO",
    telemetry: { enabled: true },
    autopilot: {
      enabled: true,
      maxRetries: 5,
      defaultIntervalHours: 5,
      shortRetrySeconds: 60,
      autoResumePrompt: "继续",
    },
    codebuddyCliPath: "codebuddy",
    opencodeCliPath: "opencode",
    platforms: {},
    ...values,
  };
}

function validateConfigForPlatform(platform: string, config: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const c = config;

  switch (platform) {
    case "telegram":
      if (!c.botToken || typeof c.botToken !== "string" || !clean(c.botToken)) {
        errors.push("Telegram bot token is required and must be a non-empty string.");
      }
      if (c.proxy && typeof c.proxy !== "string") {
        errors.push("Proxy must be a string if provided.");
      }
      break;

    case "feishu":
      if (!c.appId || typeof c.appId !== "string" || !clean(c.appId)) {
        errors.push("Feishu app ID is required and must be a non-empty string.");
      }
      if (!c.appSecret || typeof c.appSecret !== "string" || !clean(c.appSecret)) {
        errors.push("Feishu app secret is required and must be a non-empty string.");
      }
      break;

    case "qq":
      if (!c.appId || typeof c.appId !== "string" || !clean(c.appId)) {
        errors.push("QQ app ID is required and must be a non-empty string.");
      }
      if (!c.secret || typeof c.secret !== "string" || !clean(c.secret)) {
        errors.push("QQ app secret is required and must be a non-empty string.");
      }
      break;

    case "wework":
      if (!c.corpId || typeof c.corpId !== "string" || !clean(c.corpId)) {
        errors.push("WeWork corp ID is required and must be a non-empty string.");
      }
      if (!c.secret || typeof c.secret !== "string" || !clean(c.secret)) {
        errors.push("WeWork secret is required and must be a non-empty string.");
      }
      break;

    case "dingtalk":
      if (!c.clientId || typeof c.clientId !== "string" || !clean(c.clientId)) {
        errors.push("DingTalk client ID is required and must be a non-empty string.");
      }
      if (!c.clientSecret || typeof c.clientSecret !== "string" || !clean(c.clientSecret)) {
        errors.push("DingTalk client secret is required and must be a non-empty string.");
      }
      break;

    case "workbuddy":
      if (!c.accessToken || typeof c.accessToken !== "string" || !clean(c.accessToken)) {
        errors.push("WorkBuddy access token is required and must be a non-empty string.");
      }
      if (!c.refreshToken || typeof c.refreshToken !== "string" || !clean(c.refreshToken)) {
        errors.push("WorkBuddy refresh token is required and must be a non-empty string.");
      }
      if (!c.userId || typeof c.userId !== "string" || !clean(c.userId)) {
        errors.push("WorkBuddy user ID is required and must be a non-empty string.");
      }
      break;

    case "clawbot":
      if (!c.apiToken || typeof c.apiToken !== "string" || !clean(c.apiToken)) {
        errors.push("ClawBot API token is required and must be a non-empty string.");
      }
      break;

    default:
      errors.push(`Unknown platform: ${platform}`);
  }

  return errors;
}

async function probeTelegram(config: Record<string, unknown>): Promise<string> {
  const botToken = clean(String(config.botToken ?? ""));
  if (!botToken) throw new Error("Telegram bot token is required.");

  const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, {
    signal: AbortSignal.timeout(PLATFORM_TEST_TIMEOUT_MS),
  });
  const body = await readJsonResponse(response);
  if (!response.ok || body.ok !== true) {
    throw new Error(String(body.description ?? body.error_code ?? `HTTP ${response.status}`));
  }

  const result = (body.result ?? {}) as Record<string, unknown>;
  const username = typeof result.username === "string" ? `@${result.username}` : "bot";
  return `Telegram reachable as ${username}.`;
}

async function probeFeishu(config: Record<string, unknown>): Promise<string> {
  const appId = clean(String(config.appId ?? ""));
  const appSecret = clean(String(config.appSecret ?? ""));
  if (!appId || !appSecret) throw new Error("Feishu app ID and app secret are required.");

  const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    signal: AbortSignal.timeout(PLATFORM_TEST_TIMEOUT_MS),
  });
  const body = await readJsonResponse(response);
  if (!response.ok || body.code !== 0) {
    throw new Error(String(body.msg ?? body.message ?? `HTTP ${response.status}`));
  }

  return "Feishu credentials are valid.";
}

async function probeQQ(config: Record<string, unknown>): Promise<string> {
  const appId = clean(String(config.appId ?? ""));
  const secret = clean(String(config.secret ?? ""));
  if (!appId || !secret) throw new Error("QQ app ID and app secret are required.");

  const response = await fetch("https://bots.qq.com/app/getAppAccessToken", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ appId, clientSecret: secret }),
    signal: AbortSignal.timeout(PLATFORM_TEST_TIMEOUT_MS),
  });
  const body = await readJsonResponse(response);
  if (!response.ok || typeof body.access_token !== "string" || body.access_token.length === 0) {
    throw new Error(String(body.message ?? `HTTP ${response.status}`));
  }

  return "QQ credentials are valid.";
}

async function probeWeWork(config: Record<string, unknown>): Promise<string> {
  const corpId = clean(String(config.corpId ?? ""));
  const secret = clean(String(config.secret ?? ""));
  if (!corpId || !secret) throw new Error("WeWork corp ID and secret are required.");

  try {
    await initWeWork(
      createProbeConfig({ weworkCorpId: corpId, weworkSecret: secret }),
      async () => {},
    );
    return "WeWork WebSocket authentication succeeded.";
  } finally {
    stopWeWork();
  }
}

async function probeDingTalk(config: Record<string, unknown>): Promise<string> {
  const clientId = clean(String(config.clientId ?? ""));
  const clientSecret = clean(String(config.clientSecret ?? ""));
  if (!clientId || !clientSecret) throw new Error("DingTalk client ID and client secret are required.");

  const client = new DWClient({
    clientId,
    clientSecret,
    keepAlive: false,
    debug: false,
  });

  const token = await Promise.race([
    client.getAccessToken(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("DingTalk access token request timed out.")), PLATFORM_TEST_TIMEOUT_MS),
    ),
  ]);

  if (typeof token !== "string" || token.length === 0) {
    throw new Error("DingTalk did not return an access token.");
  }

  return "DingTalk credentials are valid.";
}

async function probeWorkBuddy(config: Record<string, unknown>): Promise<string> {
  const accessToken = clean(String(config.accessToken ?? ""));
  const refreshToken = clean(String(config.refreshToken ?? ""));
  const userId = clean(String(config.userId ?? ""));
  if (!accessToken || !refreshToken || !userId) throw new Error("WorkBuddy access token, refresh token, and user ID are required.");

  const baseUrl = clean(String(config.baseUrl ?? "")) || "https://copilot.tencent.com";

  // Validate credentials by attempting to register workspace (same endpoint as runtime)
  const response = await fetch(`${baseUrl}/v2/agentos/localagent/registerWorkspace`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      userId,
      hostId: "open-im-test",
      workspaceId: "open-im-test-workspace",
      workspaceName: "OpenIM Test Workspace",
      localAgentType: "ide",
    }),
    signal: AbortSignal.timeout(PLATFORM_TEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`WorkBuddy authentication failed: ${body.slice(0, 200) || `HTTP ${response.status}`}`);
  }

  return "WorkBuddy credentials are valid.";
}

async function probeClawBot(config: Record<string, unknown>): Promise<string> {
  const apiUrl = clean(String(config.apiUrl ?? "http://127.0.0.1:26322"));
  const apiToken = clean(String(config.apiToken ?? ""));
  if (!apiToken) throw new Error("ClawBot API token is required.");

  const { randomUUID } = await import('node:crypto');
  const response = await fetch(`${apiUrl}/ilink/bot/getupdates?timeout=1&bot_token=${encodeURIComponent(apiToken)}`, {
    headers: {
      'Content-Type': 'application/json',
      'AuthorizationType': 'ilink_bot_token',
      'iLink-App-Id': 'bot',
      'iLink-App-ClientVersion': '131588',
      'X-WECHAT-UIN': randomUUID(),
    },
    signal: AbortSignal.timeout(PLATFORM_TEST_TIMEOUT_MS),
  });
  const body = await readJsonResponse(response);
  const ok = body.ok === true || body.ret === 0 || body.ret === '0';
  if (!response.ok || !ok) {
    throw new Error(String(body.error ?? body.description ?? `HTTP ${response.status}`));
  }

  return "ClawBot API reachable.";
}

export async function testPlatformConfig(platform: string, config: Record<string, unknown>): Promise<string> {
  const errors = validateConfigForPlatform(platform, config);
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }

  switch (platform) {
    case "telegram":
      return probeTelegram(config);
    case "feishu":
      return probeFeishu(config);
    case "qq":
      return probeQQ(config);
    case "wework":
      return probeWeWork(config);
    case "dingtalk":
      return probeDingTalk(config);
    case "workbuddy":
      return probeWorkBuddy(config);
    case "clawbot":
      return probeClawBot(config);
    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}
