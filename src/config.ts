try {
  await import('dotenv/config');
} catch {
  /* dotenv optional */
}

import { accessSync, constants } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, isAbsolute } from 'node:path';
import { createLogger, type LogLevel } from './logger.js';
import {
  APP_HOME,
  DEFAULT_TELEMETRY_INGEST_URL,
  DEFAULT_TELEMETRY_INGEST_TOKEN,
} from './constants.js';

const log = createLogger('config');

// Re-export all types from config/types.ts
export type {
  Platform,
  AiCommand,
  Config,
  FilePlatformTelegram,
  FilePlatformFeishu,
  FilePlatformQQ,
  FilePlatformWechat,
  FilePlatformWework,
  FilePlatformDingtalk,
  FilePlatformWorkBuddy,
  FilePlatformClawbot,
  FileToolClaude,
  FileToolCodex,
  FileToolCodeBuddy,
  FileConfig,
} from './config/types.js';

import type { Platform, AiCommand, Config, FileConfig, FilePlatformWechat } from './config/types.js';

/** 分渠道 AI 工具：未配置时使用 AI_COMMAND / 旧版根级 aiCommand / 默认 claude */
function resolveFilePlatformAi(file: FileConfig, platform: Platform): AiCommand {
  const pf = file.platforms;
  const raw =
    platform === 'telegram'
      ? pf?.telegram?.aiCommand
      : platform === 'feishu'
        ? pf?.feishu?.aiCommand
        : platform === 'qq'
          ? pf?.qq?.aiCommand
          : platform === 'wework'
            ? pf?.wework?.aiCommand
            : platform === 'dingtalk'
              ? pf?.dingtalk?.aiCommand
              : platform === 'clawbot'
                ? pf?.clawbot?.aiCommand
                : pf?.workbuddy?.aiCommand;
  return normalizeAiCommand(raw ?? process.env.AI_COMMAND ?? file.aiCommand, 'claude');
}

// Re-export file I/O and credential helpers from sub-modules
export {
  CONFIG_PATH,
  loadFileConfig,
  saveFileConfig,
  getClaudeConfigHome,
  getClaudeSdkRuntimeIssue,
  hasCodeBuddyAuthIndicators,
  loadClaudeSettingsEnv,
  saveClaudeSettingsEnv,
  normalizeAiCommand,
  hasCodexAuth,
  parseCommaSeparated,
  CLAUDE_AUTH_ENV_KEYS,
  refreshClaudeEnvToProcess,
  processEnvForNonClaudeCliChild,
  CODEX_AUTH_PATHS,
} from './config/file-io.js';

import {
  getClaudeSdkRuntimeIssue,
  hasCodeBuddyAuthIndicators,
  loadFileConfig,
  normalizeAiCommand,
  hasCodexAuth,
  parseCommaSeparated,
  loadClaudeSettingsEnv,
} from './config/file-io.js';

/** 检测是否需要交互式配置（无 token 且无环境变量） */
export function needsSetup(): boolean {
  // 环境变量已提供任一平台的凭证，则认为已配置
  if (process.env.TELEGRAM_BOT_TOKEN) return false;
  if (process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET) return false;
  if (process.env.QQ_BOT_APPID && process.env.QQ_BOT_SECRET) return false;
  if (
    process.env.WECHAT_WORKBUDDY_ACCESS_TOKEN &&
    process.env.WECHAT_WORKBUDDY_REFRESH_TOKEN
  ) {
    return false;
  }
  if (process.env.WEWORK_CORP_ID && process.env.WEWORK_SECRET) return false;
  if (process.env.DINGTALK_CLIENT_ID && process.env.DINGTALK_CLIENT_SECRET) return false;

  const file = loadFileConfig();
  const tg = file.platforms?.telegram;
  const fs = file.platforms?.feishu;
  const qq = file.platforms?.qq;
  const ww = file.platforms?.wework;
  const dt = file.platforms?.dingtalk;
  const wb = file.platforms?.workbuddy;
  const cb = file.platforms?.clawbot;
  // Also check legacy platforms.wechat for migration path
  const legacyWc = (file.platforms as Record<string, unknown>)?.wechat as FilePlatformWechat | undefined;

  const hasTelegram = !!tg?.botToken;
  const hasFeishu = !!(fs?.appId && fs?.appSecret);
  const hasQQ = !!(qq?.appId && qq?.secret);
  const hasWework = !!(ww?.corpId && ww?.secret);
  const hasDingtalk = !!(dt?.clientId && dt?.clientSecret);
  const hasWorkBuddy = !!(wb?.accessToken && wb?.refreshToken && wb?.userId);
  const hasClawBot = !!(cb?.apiToken);
  const hasLegacyWechat = !!(legacyWc?.workbuddyAccessToken && legacyWc?.workbuddyRefreshToken);

  return !hasTelegram && !hasFeishu && !hasQQ && !hasWework && !hasDingtalk && !hasWorkBuddy && !hasClawBot && !hasLegacyWechat;
}

export function loadConfig(): Config {
  const file = loadFileConfig();

  // tools.claude.env 与 ~/.claude/settings.json 不在此处合并到 process.env，
  // 由 Claude adapter 在创建 session 前 refreshClaudeEnvToProcess，避免污染 Codex/CodeBuddy 子进程。

  const fileTelegram = file.platforms?.telegram;
  const fileFeishu = file.platforms?.feishu;
  const fileQQ = file.platforms?.qq;
  const fileWework = file.platforms?.wework;
  const fileDingtalk = file.platforms?.dingtalk;
  const fileClawbot = file.platforms?.clawbot;
  // Auto-migrate legacy platforms.wechat WorkBuddy credentials → platforms.workbuddy
  const legacyWechat = (file.platforms as Record<string, unknown>)?.wechat as FilePlatformWechat | undefined;
  const fileWorkBuddy = file.platforms?.workbuddy ?? (
    legacyWechat?.workbuddyAccessToken && legacyWechat?.workbuddyRefreshToken
      ? {
          accessToken: legacyWechat.workbuddyAccessToken,
          refreshToken: legacyWechat.workbuddyRefreshToken,
          userId: legacyWechat.userId,
          baseUrl: legacyWechat.workbuddyBaseUrl,
        }
      : undefined
  );

  // 1. 加载各平台凭证（env 优先，其次新结构，最后旧字段）
  const telegramBotToken =
    process.env.TELEGRAM_BOT_TOKEN ??
    fileTelegram?.botToken ??
    file.telegramBotToken;

  const feishuAppId =
    process.env.FEISHU_APP_ID ??
    fileFeishu?.appId ??
    file.feishuAppId;
  const feishuAppSecret =
    process.env.FEISHU_APP_SECRET ??
    fileFeishu?.appSecret ??
    file.feishuAppSecret;

  const qqAppId =
    process.env.QQ_BOT_APPID ??
    fileQQ?.appId;
  const qqSecret =
    process.env.QQ_BOT_SECRET ??
    fileQQ?.secret;

  const weworkCorpId =
    process.env.WEWORK_CORP_ID ??
    fileWework?.corpId;
  const weworkSecret =
    process.env.WEWORK_SECRET ??
    fileWework?.secret;
  const weworkWsUrl =
    process.env.WEWORK_WS_URL ??
    fileWework?.wsUrl;

  const dingtalkClientId =
    process.env.DINGTALK_CLIENT_ID ??
    fileDingtalk?.clientId;
  const dingtalkClientSecret =
    process.env.DINGTALK_CLIENT_SECRET ??
    fileDingtalk?.clientSecret;
  const dingtalkCardTemplateId =
    process.env.DINGTALK_CARD_TEMPLATE_ID ??
    fileDingtalk?.cardTemplateId;

  // WorkBuddy credentials
  const workbuddyAccessToken =
    process.env.WORKBUDDY_ACCESS_TOKEN ??
    fileWorkBuddy?.accessToken;
  const workbuddyRefreshToken =
    process.env.WORKBUDDY_REFRESH_TOKEN ??
    fileWorkBuddy?.refreshToken;
  const workbuddyUserId =
    process.env.WORKBUDDY_USER_ID ??
    fileWorkBuddy?.userId;
  const workbuddyBaseUrl =
    process.env.WORKBUDDY_BASE_URL ??
    fileWorkBuddy?.baseUrl;
  const workbuddyGuid =
    process.env.WORKBUDDY_GUID ??
    fileWorkBuddy?.guid;
  const workbuddyWorkspacePath =
    process.env.WORKBUDDY_WORKSPACE_PATH ??
    fileWorkBuddy?.workspacePath;

  // ClawBot credentials
  const clawbotApiUrl =
    process.env.CLAWBOT_API_URL ??
    fileClawbot?.apiUrl;
  const clawbotApiToken =
    process.env.CLAWBOT_API_TOKEN ??
    fileClawbot?.apiToken;

  // 2. 计算启用平台
  const enabledPlatforms: Platform[] = [];

  const telegramEnabledFlag = fileTelegram?.enabled;
  const feishuEnabledFlag = fileFeishu?.enabled;
  const qqEnabledFlag = fileQQ?.enabled;
  const weworkEnabledFlag = fileWework?.enabled;
  const dingtalkEnabledFlag = fileDingtalk?.enabled;
  const workbuddyEnabledFlag = fileWorkBuddy?.enabled;
  const clawbotEnabledFlag = fileClawbot?.enabled;

  const telegramEnabled =
    !!telegramBotToken && (telegramEnabledFlag !== false);
  const feishuEnabled =
    !!(feishuAppId && feishuAppSecret) && (feishuEnabledFlag !== false);
  const qqEnabled =
    !!(qqAppId && qqSecret) && (qqEnabledFlag !== false);
  const weworkEnabled =
    !!(weworkCorpId && weworkSecret) && (weworkEnabledFlag !== false);
  const dingtalkEnabled =
    !!(dingtalkClientId && dingtalkClientSecret) && (dingtalkEnabledFlag !== false);
  const workbuddyEnabled =
    !!(workbuddyAccessToken && workbuddyRefreshToken && workbuddyUserId) && (workbuddyEnabledFlag !== false);
  const clawbotEnabled =
    !!clawbotApiToken && (clawbotEnabledFlag !== false);

  if (telegramEnabled) enabledPlatforms.push('telegram');
  if (feishuEnabled) enabledPlatforms.push('feishu');
  if (qqEnabled) enabledPlatforms.push('qq');
  if (weworkEnabled) enabledPlatforms.push('wework');
  if (dingtalkEnabled) enabledPlatforms.push('dingtalk');
  if (workbuddyEnabled) enabledPlatforms.push('workbuddy');
  if (clawbotEnabled) enabledPlatforms.push('clawbot');

  if (enabledPlatforms.length === 0) {
    throw new Error('至少需要配置 Telegram、Feishu、WeChat、WeWork 或 DingTalk 其中一个平台（可以通过环境变量或 config.json）');
  }

  // 3. 全局白名单（旧字段，向后兼容，主要用于作为 per-platform 的兜底）
  const allowedUserIds: string[] =
    process.env.ALLOWED_USER_IDS !== undefined
      ? parseCommaSeparated(process.env.ALLOWED_USER_IDS)
      : file.allowedUserIds ?? [];

  // 4. 分平台白名单（新字段）
  const telegramAllowedUserIds =
    process.env.TELEGRAM_ALLOWED_USER_IDS !== undefined
      ? parseCommaSeparated(process.env.TELEGRAM_ALLOWED_USER_IDS)
      : fileTelegram?.allowedUserIds ?? allowedUserIds;

  const feishuAllowedUserIds =
    process.env.FEISHU_ALLOWED_USER_IDS !== undefined
      ? parseCommaSeparated(process.env.FEISHU_ALLOWED_USER_IDS)
      : fileFeishu?.allowedUserIds ?? allowedUserIds;

  const qqAllowedUserIds =
    process.env.QQ_ALLOWED_USER_IDS !== undefined
      ? parseCommaSeparated(process.env.QQ_ALLOWED_USER_IDS)
      : fileQQ?.allowedUserIds ?? allowedUserIds;

  const weworkAllowedUserIds =
    process.env.WEWORK_ALLOWED_USER_IDS !== undefined
      ? parseCommaSeparated(process.env.WEWORK_ALLOWED_USER_IDS)
      : fileWework?.allowedUserIds ?? allowedUserIds;

  const dingtalkAllowedUserIds =
    process.env.DINGTALK_ALLOWED_USER_IDS !== undefined
      ? parseCommaSeparated(process.env.DINGTALK_ALLOWED_USER_IDS)
      : fileDingtalk?.allowedUserIds ?? allowedUserIds;

  const workbuddyAllowedUserIds =
    process.env.WORKBUDDY_ALLOWED_USER_IDS !== undefined
      ? parseCommaSeparated(process.env.WORKBUDDY_ALLOWED_USER_IDS)
      : fileWorkBuddy?.allowedUserIds ?? allowedUserIds;

  const clawbotAllowedUserIds =
    process.env.CLAWBOT_ALLOWED_USER_IDS !== undefined
      ? parseCommaSeparated(process.env.CLAWBOT_ALLOWED_USER_IDS)
      : fileClawbot?.allowedUserIds ?? allowedUserIds;

  // 5. AI / 工作目录 / 安全配置（从 tools 读取）
  const tc = file.tools?.claude ?? {};
  const tcod = file.tools?.codex ?? {};
  const tcb = file.tools?.codebuddy ?? {};

  const claudeProxy = process.env.CLAUDE_PROXY ?? tc.proxy;
  const codexProxy = process.env.CODEX_PROXY ?? tcod.proxy;
  let codexCliPath = process.env.CODEX_CLI_PATH ?? tcod.cliPath ?? 'codex';
  if (process.platform === 'win32' && codexCliPath === 'codex') {
    const npmPaths = [
      join(process.env.APPDATA || '', 'npm', 'codex.cmd'),
      join(process.env.LOCALAPPDATA || '', 'npm', 'codex.cmd'),
    ];
    for (const p of npmPaths) {
      try {
        accessSync(p, constants.F_OK);
        codexCliPath = p;
        break;
      } catch {
        /* 尝试下一个路径 */
      }
    }
  }
  let codebuddyCliPath = process.env.CODEBUDDY_CLI_PATH ?? tcb.cliPath ?? 'codebuddy';
  if (process.platform === 'win32' && codebuddyCliPath === 'codebuddy') {
    const npmPaths = [
      join(process.env.APPDATA || '', 'npm', 'codebuddy.cmd'),
      join(process.env.LOCALAPPDATA || '', 'npm', 'codebuddy.cmd'),
    ];
    for (const p of npmPaths) {
      try {
        accessSync(p, constants.F_OK);
        codebuddyCliPath = p;
        break;
      } catch {
        /* 尝试下一个路径 */
      }
    }
  }
  const claudeWorkDir = process.env.CLAUDE_WORK_DIR ?? tc.workDir ?? process.cwd();
  const skipPermissions: boolean = process.env.OPEN_IM_SKIP_PERMISSIONS === 'false'
    ? false
    : (tc.skipPermissions ?? true);

  const envIdleRaw = process.env.OPEN_IM_CLAUDE_SESSION_IDLE_TTL_MINUTES;
  const envIdleParsed =
    envIdleRaw !== undefined && envIdleRaw !== '' ? Number.parseInt(envIdleRaw, 10) : NaN;
  const fileIdle = tc.sessionIdleTtlMinutes;
  let claudeSessionIdleTtlMinutes: number;
  if (Number.isFinite(envIdleParsed)) {
    claudeSessionIdleTtlMinutes = Math.max(0, envIdleParsed);
  } else if (typeof fileIdle === 'number' && Number.isFinite(fileIdle)) {
    claudeSessionIdleTtlMinutes = Math.max(0, fileIdle);
  } else {
    claudeSessionIdleTtlMinutes = 30;
  }

  // 6. 校验 Claude API 凭证（任一已启用渠道使用 claude 时需配置）
  const toolsNeeded = new Set<AiCommand>();
  for (const p of enabledPlatforms) {
    toolsNeeded.add(resolveFilePlatformAi(file, p));
  }
  if (toolsNeeded.has('claude')) {
    // 校验凭证时直接从各来源读取，不修改 process.env
    const claudeToolEnvForCheck = file.tools?.claude?.env as Record<string, string> | undefined;
    const claudeSettingsForCheck = loadClaudeSettingsEnv();
    const hasCreds = !!(
      process.env.ANTHROPIC_API_KEY ||
      process.env.ANTHROPIC_AUTH_TOKEN ||
      process.env.CLAUDE_CODE_OAUTH_TOKEN ||
      process.env.ANTHROPIC_BASE_URL ||
      claudeToolEnvForCheck?.ANTHROPIC_API_KEY ||
      claudeToolEnvForCheck?.ANTHROPIC_AUTH_TOKEN ||
      claudeToolEnvForCheck?.ANTHROPIC_BASE_URL ||
      claudeSettingsForCheck.ANTHROPIC_API_KEY ||
      claudeSettingsForCheck.ANTHROPIC_AUTH_TOKEN ||
      claudeSettingsForCheck.CLAUDE_CODE_OAUTH_TOKEN ||
      claudeSettingsForCheck.ANTHROPIC_BASE_URL
    );

    if (!hasCreds) {
      const errorMsg = [
        '',
        '━━━ 未配置 Claude API 凭证 ━━━',
        '',
        '使用 Claude 需要配置以下之一：',
        '  - 官方 API：ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN',
        '  - 第三方/自定义 API：ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN + ANTHROPIC_MODEL',
        '',
        '方式 1：环境变量',
        '  export ANTHROPIC_API_KEY="sk-ant-..."',
        '  或 export ANTHROPIC_AUTH_TOKEN="your-token"',
        '  或 export ANTHROPIC_BASE_URL="https://your-api" ANTHROPIC_MODEL="glm-4.7"',
        '',
        '方式 2：运行配置向导',
        '  open-im init',
        '',
        '方式 3：编辑配置文件',
        '  ~/.open-im/config.json: tools.claude.env.ANTHROPIC_MODEL = "..."',
        '  ~/.claude/settings.json: env.ANTHROPIC_MODEL = "..."（与 Claude Code 共用）',
        '',
      ].join('\n');
      throw new Error(errorMsg);
    }

    const claudeRuntimeIssue = getClaudeSdkRuntimeIssue();
    if (claudeRuntimeIssue) {
      throw new Error(claudeRuntimeIssue);
    }
  }

  // 7. 校验 Codex CLI（任一已启用渠道使用 codex 时）
  if (toolsNeeded.has('codex')) {
    if (isAbsolute(codexCliPath) || codexCliPath.includes('/') || codexCliPath.includes('\\')) {
      try {
        accessSync(codexCliPath, constants.F_OK);
      } catch {
        throw new Error(`Codex CLI 不可执行: ${codexCliPath}`);
      }
    } else {
      const checkCommand = process.platform === 'win32' ? 'where' : 'which';
      try {
        execFileSync(checkCommand, [codexCliPath], {
          stdio: 'pipe',
          windowsHide: process.platform === 'win32',
        });
      } catch {
        const installGuide = [
          '',
          '━━━ Codex CLI 未安装 ━━━',
          '',
          '使用 Codex 需要先安装 OpenAI Codex CLI。',
          '',
          '安装方法：',
          '',
          '  npm install -g @openai/codex',
          '',
          '或: brew install --cask codex',
          '',
          '安装后运行 codex login 登录，并用 codex exec --help 验证。',
          '',
        ].join('\n');
        throw new Error(installGuide);
      }
    }
    if (!hasCodexAuth()) {
      log.warn(
        'Codex 模式：未检测到 OPENAI_API_KEY 或 Codex 登录态。首次使用请先运行 codex login，' +
        '或在 shell 中 export OPENAI_API_KEY。'
      );
    }
  }

  // 8. 校验 CodeBuddy CLI（任一已启用渠道使用 codebuddy 时）
  if (toolsNeeded.has('codebuddy')) {
    if (isAbsolute(codebuddyCliPath) || codebuddyCliPath.includes('/') || codebuddyCliPath.includes('\\')) {
      try {
        accessSync(codebuddyCliPath, constants.F_OK);
      } catch {
        throw new Error(`CodeBuddy CLI 不可执行: ${codebuddyCliPath}`);
      }
    } else {
      const checkCommand = process.platform === 'win32' ? 'where' : 'which';
      try {
        execFileSync(checkCommand, [codebuddyCliPath], {
          stdio: 'pipe',
          windowsHide: process.platform === 'win32',
        });
      } catch {
        const installGuide = [
          '',
          '━━━ CodeBuddy CLI 未安装 ━━━',
          '',
          '使用 CodeBuddy 需要先安装 CodeBuddy Code CLI。',
          '',
          '安装方法：',
          '',
          '  npm install -g @tencent-ai/codebuddy-code',
          '',
          '安装后运行 codebuddy --version 验证，再执行 codebuddy login 登录。',
          '',
        ].join('\n');
        throw new Error(installGuide);
      }
    }

    if (!hasCodeBuddyAuthIndicators()) {
      log.warn(
        'CodeBuddy 模式：未检测到明确的登录态或 API Key。首次使用请先运行 codebuddy login；' +
        '若使用自定义 Token，请在 CodeBuddy 设置或环境变量中配置。'
      );
    }
  }

  // 7. 日志与平台配置
  const logDir = process.env.LOG_DIR ?? file.logDir ?? join(APP_HOME, 'logs');
  const logLevel = (process.env.LOG_LEVEL?.toUpperCase() ?? file.logLevel ?? 'INFO') as LogLevel;

  const telemetryEnv = process.env.OPEN_IM_TELEMETRY?.trim().toLowerCase();
  let telemetryEnabled: boolean;
  if (telemetryEnv === 'false' || telemetryEnv === '0' || telemetryEnv === 'no') {
    telemetryEnabled = false;
  } else if (telemetryEnv === 'true' || telemetryEnv === '1' || telemetryEnv === 'yes') {
    telemetryEnabled = true;
  } else if (file.telemetry?.enabled === false) {
    telemetryEnabled = false;
  } else if (file.telemetry?.enabled === true) {
    telemetryEnabled = true;
  } else {
    telemetryEnabled = true;
  }

  let telemetryUrl: string | undefined;
  const telemetryUrlRaw = process.env.OPEN_IM_TELEMETRY_URL ?? file.telemetry?.url;
  if (telemetryUrlRaw && typeof telemetryUrlRaw === 'string' && telemetryUrlRaw.trim()) {
    try {
      const u = new URL(telemetryUrlRaw.trim());
      if (u.protocol !== 'https:') {
        log.warn('OPEN_IM_TELEMETRY_URL / telemetry.url 必须为 https，已忽略上传地址');
      } else {
        telemetryUrl = u.href;
      }
    } catch {
      log.warn('无效的 OPEN_IM_TELEMETRY_URL / telemetry.url，已忽略上传地址');
    }
  }

  if (!telemetryUrl && telemetryEnabled && DEFAULT_TELEMETRY_INGEST_URL.trim()) {
    try {
      const u = new URL(DEFAULT_TELEMETRY_INGEST_URL.trim());
      if (u.protocol === 'https:') {
        telemetryUrl = u.href;
      }
    } catch {
      /* ignore */
    }
  }

  let telemetryToken: string | undefined;
  if (process.env.OPEN_IM_TELEMETRY_TOKEN !== undefined) {
    const t = process.env.OPEN_IM_TELEMETRY_TOKEN.trim();
    telemetryToken = t.length > 0 ? t : undefined;
  } else if (file.telemetry?.token !== undefined) {
    const t = String(file.telemetry.token).trim();
    telemetryToken = t.length > 0 ? t : undefined;
  } else {
    telemetryToken = DEFAULT_TELEMETRY_INGEST_TOKEN.trim() || undefined;
  }

  if (telemetryEnabled && !telemetryUrl) {
    log.warn(
      '遥测已开启但未配置有效的 HTTPS 采集 URL：仅写入本地 events-*.jsonl；可设置 OPEN_IM_TELEMETRY_URL 或在 constants 中配置 DEFAULT_TELEMETRY_INGEST_URL。'
    );
  }

  const platforms: Config['platforms'] = {
    telegram: telegramEnabled
      ? {
          enabled: true,
          aiCommand: resolveFilePlatformAi(file, 'telegram'),
          proxy: process.env.TELEGRAM_PROXY ?? file.platforms?.telegram?.proxy,
          allowedUserIds: telegramAllowedUserIds,
        }
      : {
          enabled: false,
          aiCommand: resolveFilePlatformAi(file, 'telegram'),
          proxy: process.env.TELEGRAM_PROXY ?? file.platforms?.telegram?.proxy,
          allowedUserIds: telegramAllowedUserIds,
        },
    feishu: feishuEnabled
      ? {
          enabled: true,
          aiCommand: resolveFilePlatformAi(file, 'feishu'),
          allowedUserIds: feishuAllowedUserIds,
        }
      : {
          enabled: false,
          aiCommand: resolveFilePlatformAi(file, 'feishu'),
          allowedUserIds: feishuAllowedUserIds,
        },
    qq: qqEnabled
      ? {
          enabled: true,
          aiCommand: resolveFilePlatformAi(file, 'qq'),
          allowedUserIds: qqAllowedUserIds,
        }
      : {
          enabled: false,
          aiCommand: resolveFilePlatformAi(file, 'qq'),
          allowedUserIds: qqAllowedUserIds,
        },
    wework: weworkEnabled
      ? {
          enabled: true,
          aiCommand: resolveFilePlatformAi(file, 'wework'),
          allowedUserIds: weworkAllowedUserIds,
        }
      : {
          enabled: false,
          aiCommand: resolveFilePlatformAi(file, 'wework'),
          allowedUserIds: weworkAllowedUserIds,
        },
    dingtalk: dingtalkEnabled
      ? {
          enabled: true,
          aiCommand: resolveFilePlatformAi(file, 'dingtalk'),
          allowedUserIds: dingtalkAllowedUserIds,
          cardTemplateId: dingtalkCardTemplateId,
        }
      : {
          enabled: false,
          aiCommand: resolveFilePlatformAi(file, 'dingtalk'),
          allowedUserIds: dingtalkAllowedUserIds,
          cardTemplateId: dingtalkCardTemplateId,
        },
    workbuddy: workbuddyEnabled
      ? {
          enabled: true,
          aiCommand: resolveFilePlatformAi(file, 'workbuddy'),
          allowedUserIds: workbuddyAllowedUserIds,
          accessToken: workbuddyAccessToken,
          refreshToken: workbuddyRefreshToken,
          userId: workbuddyUserId,
          baseUrl: workbuddyBaseUrl,
          guid: workbuddyGuid,
          workspacePath: workbuddyWorkspacePath,
        }
      : {
          enabled: false,
          aiCommand: resolveFilePlatformAi(file, 'workbuddy'),
          allowedUserIds: workbuddyAllowedUserIds,
          accessToken: workbuddyAccessToken,
          refreshToken: workbuddyRefreshToken,
          userId: workbuddyUserId,
          baseUrl: workbuddyBaseUrl,
          guid: workbuddyGuid,
          workspacePath: workbuddyWorkspacePath,
        },
    clawbot: clawbotEnabled
      ? {
          enabled: true,
          aiCommand: resolveFilePlatformAi(file, 'clawbot'),
          allowedUserIds: clawbotAllowedUserIds,
          apiUrl: clawbotApiUrl,
          apiToken: clawbotApiToken,
        }
      : {
          enabled: false,
          aiCommand: resolveFilePlatformAi(file, 'clawbot'),
          allowedUserIds: clawbotAllowedUserIds,
          apiUrl: clawbotApiUrl,
          apiToken: clawbotApiToken,
        },
  };

  return {
    enabledPlatforms,
    telegramBotToken: telegramBotToken ?? '',
    feishuAppId: feishuAppId ?? '',
    feishuAppSecret: feishuAppSecret ?? '',
    qqAppId: qqAppId ?? '',
    qqSecret: qqSecret ?? '',
    weworkCorpId: weworkCorpId ?? '',
    weworkSecret: weworkSecret ?? '',
    weworkWsUrl: weworkWsUrl,
    dingtalkClientId: dingtalkClientId ?? '',
    dingtalkClientSecret: dingtalkClientSecret ?? '',
    dingtalkCardTemplateId: dingtalkCardTemplateId ?? '',
    allowedUserIds,
    telegramAllowedUserIds,
    feishuAllowedUserIds,
    qqAllowedUserIds,
    weworkAllowedUserIds,
    dingtalkAllowedUserIds,
    workbuddyAllowedUserIds,
    clawbotAllowedUserIds,
    codexCliPath,
    codebuddyCliPath,
    claudeProxy,
    codexProxy,
    claudeWorkDir,
    claudeSessionIdleTtlMinutes,
    claudeModel: process.env.ANTHROPIC_MODEL,
    skipPermissions,
    logDir,
    logLevel,
    telemetry: {
      enabled: telemetryEnabled,
      url: telemetryUrl,
      token: telemetryToken,
    },
    platforms,
  };
}

/** 获取已配置凭证的平台列表 */
export function getPlatformsWithCredentials(config: Config): Platform[] {
  const r: Platform[] = [];
  if (config.telegramBotToken) r.push('telegram');
  if (config.feishuAppId && config.feishuAppSecret) r.push('feishu');
  if (config.qqAppId && config.qqSecret) r.push('qq');
  if (config.weworkCorpId && config.weworkSecret) r.push('wework');
  if (config.dingtalkClientId && config.dingtalkClientSecret) r.push('dingtalk');
  const wb = config.platforms.workbuddy;
  if (wb?.accessToken && wb?.refreshToken) r.push('workbuddy');
  const cb = config.platforms.clawbot;
  if (cb?.apiToken) r.push('clawbot');
  return r;
}

export function resolvePlatformAiCommand(config: Config, platform: Platform): AiCommand {
  const v = config.platforms[platform]?.aiCommand;
  return v === 'claude' || v === 'codex' || v === 'codebuddy' ? v : 'claude';
}

export function getConfiguredAiCommands(config: Config): AiCommand[] {
  const commands = new Set<AiCommand>();
  for (const platform of config.enabledPlatforms) {
    commands.add(resolvePlatformAiCommand(config, platform));
  }
  return Array.from(commands);
}
