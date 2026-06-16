import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, chmodSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { createLogger } from '../logger.js';
import { APP_HOME } from '../constants.js';
import type { AiCommand, FileConfig } from './types.js';

const log = createLogger('config');

export const CONFIG_PATH = join(APP_HOME, 'config.json');

export const CODEX_AUTH_PATHS = [
  join(homedir(), '.codex', 'auth.json'),
  join(homedir(), '.config', 'codex', 'auth.json'),
  join(homedir(), 'AppData', 'Roaming', 'codex', 'auth.json'),
];

const CODEBUDDY_HOME_PATHS = [
  join(homedir(), '.codebuddy'),
  join(homedir(), '.codebuddycn'),
] as const;

const OLD_ROOT_KEYS = [
  'claudeWorkDir',
  'claudeTimeoutMs',
  'claudeModel',
] as const;

const AI_COMMANDS: readonly AiCommand[] = ['claude', 'codex', 'codebuddy'];
const require = createRequire(import.meta.url);

/** Claude 认证相关的环境变量 key 列表 */
export const CLAUDE_AUTH_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
] as const;

/**
 * 不应传入 Codex / CodeBuddy 等子进程的环境变量。
 * Claude 适配器会通过 refreshClaudeEnvToProcess 把这些写入 process.env；
 * 若原样拷贝给 CLI 子进程，可能导致错误使用 ANTHROPIC_BASE_URL 等「访问地址」。
 */
const NON_CLAUDE_CLI_STRIP_KEYS = new Set<string>([
  ...CLAUDE_AUTH_ENV_KEYS,
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
]);

/**
 * 供非 Claude CLI 子进程使用的环境：拷贝当前 process.env，并移除 Anthropic/Claude 专用项。
 */
export function processEnvForNonClaudeCliChild(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || NON_CLAUDE_CLI_STRIP_KEYS.has(k)) continue;
    env[k] = v;
  }
  return env;
}

// Config cache with mtime tracking
let cachedConfig: { config: FileConfig; mtime: number } | null = null;
let cachedClaudeEnv: { env: Record<string, string>; fingerprint: string } | null = null;

// 保存进程启动时 shell 环境中的 Claude 相关 key 原始值（优先级最高，不可被文件配置覆盖）
const originalShellEnv: Partial<Record<string, string>> = {};
for (const key of CLAUDE_AUTH_ENV_KEYS) {
  if (process.env[key] !== undefined) {
    originalShellEnv[key] = process.env[key];
  }
}

function hasOldConfigFormat(raw: Record<string, unknown>): boolean {
  const hasOld = OLD_ROOT_KEYS.some((k) => raw[k] !== undefined && raw[k] !== null);
  const hasNew = raw.tools && typeof raw.tools === 'object' && (raw.tools as Record<string, unknown>).claude;
  return !!hasOld && !hasNew;
}

function migrateToNewConfigFormat(raw: Record<string, unknown>): Record<string, unknown> {
  const tools = (raw.tools as Record<string, unknown>) || {};
  const tc = (tools.claude as Record<string, unknown>) || {};
  const tcod = (tools.codex as Record<string, unknown>) || {};
  const tcb = (tools.codebuddy as Record<string, unknown>) || {};

  const migrated: Record<string, unknown> = { ...raw };
  migrated.tools = {
    claude: {
      ...tc,
      workDir: tc.workDir ?? raw.claudeWorkDir ?? process.cwd(),
      proxy: tc.proxy,
    },
    codex: {
      ...tcod,
      cliPath: tcod.cliPath ?? 'codex',
      workDir: tcod.workDir ?? raw.claudeWorkDir ?? process.cwd(),
      proxy: tcod.proxy,
    },
    codebuddy: {
      ...tcb,
      cliPath: tcb.cliPath ?? 'codebuddy',
    },
  };

  for (const k of OLD_ROOT_KEYS) {
    delete migrated[k];
  }
  return migrated;
}

export function loadFileConfig(): FileConfig {
  try {
    if (!existsSync(CONFIG_PATH)) return {};
    const stats = statSync(CONFIG_PATH);
    const currentMtime = stats.mtimeMs;

    if (cachedConfig && cachedConfig.mtime === currentMtime) {
      return cachedConfig.config;
    }

    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object') return {};

    if (hasOldConfigFormat(raw)) {
      const migrated = migrateToNewConfigFormat(raw);
      const dir = dirname(CONFIG_PATH);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(CONFIG_PATH, JSON.stringify(migrated, null, 2), 'utf-8');
      try { chmodSync(CONFIG_PATH, 0o600); } catch { /* ignore */ }
      cachedConfig = { config: migrated as FileConfig, mtime: currentMtime };
      return migrated as FileConfig;
    }

    cachedConfig = { config: raw as FileConfig, mtime: currentMtime };
    return raw as FileConfig;
  } catch {
    return {};
  }
}

export function saveFileConfig(raw: FileConfig): void {
  const dir = dirname(CONFIG_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(raw, null, 2), 'utf-8');
  cachedConfig = null;
}

export function getClaudeConfigHome(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

function claudeSettingsJsonPath(home: string): string {
  return join(home, '.claude', 'settings.json');
}

/**
 * 从单个 Claude settings JSON 根对象解析 env（与 Claude Code 行为对齐）。
 * - `env` 对象内字段优先于根上同名认证键
 * - 根上可存在 ANTHROPIC_* / CLAUDE_CODE_OAUTH_TOKEN（部分用户或旧版会写在顶层）
 */
function extractAuthEnvFromClaudeSettingsRoot(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of CLAUDE_AUTH_ENV_KEYS) {
    const v = raw[key];
    if (v != null && typeof v === 'string' && v.length > 0) {
      out[key] = v;
    }
  }
  const env = raw.env;
  if (env && typeof env === 'object' && !Array.isArray(env)) {
    for (const [k, v] of Object.entries(env as Record<string, unknown>)) {
      if (v != null && typeof k === 'string') {
        out[k] = String(v);
      }
    }
  }
  return out;
}

export function loadClaudeSettingsEnv(): Record<string, string> {
  const home = getClaudeConfigHome();
  const p = claudeSettingsJsonPath(home);
  let fingerprint = '';
  try {
    if (existsSync(p)) {
      fingerprint = `${p}:${statSync(p).mtimeMs}`;
    }
  } catch {
    /* ignore */
  }
  if (cachedClaudeEnv && cachedClaudeEnv.fingerprint === fingerprint) {
    return cachedClaudeEnv.env;
  }

  let merged: Record<string, string> = {};
  try {
    if (existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>;
      if (raw && typeof raw === 'object') {
        merged = extractAuthEnvFromClaudeSettingsRoot(raw);
      }
    }
  } catch {
    /* 文件损坏或不可读 */
  }

  cachedClaudeEnv = { env: merged, fingerprint };
  return merged;
}

export function saveClaudeSettingsEnv(env: Record<string, string>): void {
  const home = getClaudeConfigHome();
  const claudeSettingsPath = join(home, '.claude', 'settings.json');
  const claudeDir = join(home, '.claude');

  try {
    if (!existsSync(claudeDir)) {
      mkdirSync(claudeDir, { recursive: true });
    }

    let existing: Record<string, unknown> = {};
    if (existsSync(claudeSettingsPath)) {
      try {
        existing = JSON.parse(readFileSync(claudeSettingsPath, 'utf-8'));
      } catch {
        // file format error, start fresh
      }
    }

    existing.env = { ...(existing.env as Record<string, unknown> | undefined), ...env };

    writeFileSync(claudeSettingsPath, JSON.stringify(existing, null, 2), 'utf-8');
    cachedClaudeEnv = null;
  } catch (error) {
    log.error('Failed to save Claude settings:', error);
    throw new Error(`Failed to save Claude settings: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function normalizeAiCommand(value: unknown, fallback: AiCommand): AiCommand {
  return typeof value === 'string' && AI_COMMANDS.includes(value as AiCommand)
    ? (value as AiCommand)
    : fallback;
}

export function hasCodexAuth(): boolean {
  if (process.env.OPENAI_API_KEY) return true;
  return CODEX_AUTH_PATHS.some((p) => {
    try {
      return existsSync(p) && readFileSync(p, 'utf-8').trim().length > 0;
    } catch {
      return false;
    }
  });
}

export function hasCodeBuddyAuthIndicators(): boolean {
  if (process.env.CODEBUDDY_API_KEY || process.env.CODEBUDDY_AUTH_TOKEN) return true;

  return CODEBUDDY_HOME_PATHS.some((base) => {
    try {
      if (!existsSync(base)) return false;

      const settingsPath = join(base, 'settings.json');
      if (existsSync(settingsPath)) {
        try {
          const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
          if (settings.apiKeyHelper) return true;
          const env = settings.env;
          if (env && typeof env === 'object' && !Array.isArray(env)) {
            const envRecord = env as Record<string, unknown>;
            if (envRecord.CODEBUDDY_API_KEY || envRecord.CODEBUDDY_AUTH_TOKEN) return true;
          }
        } catch {
          // Ignore malformed settings and keep checking other indicators.
        }
      }

      const localStorageDir = join(base, 'local_storage');
      if (!existsSync(localStorageDir)) return false;

      return readdirSync(localStorageDir)
        .filter((name) => name.endsWith('.info'))
        .some((name) => {
          try {
            const content = readFileSync(join(localStorageDir, name), 'utf-8');
            return /"userId"\s*:|"nickname"\s*:|"enterpriseName"\s*:|"accessToken"\s*:/.test(content);
          } catch {
            return false;
          }
        });
    } catch {
      return false;
    }
  });
}

export function getClaudeSdkRuntimeIssue(): string | null {
  let executablePath: string;
  let executableArgs: string[];
  try {
    const sdkEntry = require.resolve('@anthropic-ai/claude-agent-sdk');
    const sdkDir = dirname(sdkEntry);
    const legacyCliPath = join(sdkDir, 'cli.js');
    if (existsSync(legacyCliPath)) {
      executablePath = process.execPath;
      executableArgs = [legacyCliPath, '--version'];
    } else {
      const binaryExt = process.platform === 'win32' ? '.exe' : '';
      const packageNames = process.platform === 'linux'
        ? [
            `@anthropic-ai/claude-agent-sdk-linux-${process.arch}-musl`,
            `@anthropic-ai/claude-agent-sdk-linux-${process.arch}`,
          ]
        : [`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`];

      let nativeBinaryPath: string | null = null;
      for (const packageName of packageNames) {
        try {
          const candidate = require.resolve(`${packageName}/claude${binaryExt}`);
          if (existsSync(candidate)) {
            nativeBinaryPath = candidate;
            break;
          }
        } catch {
          // Try the next package name.
        }
      }

      if (!nativeBinaryPath) {
        return `Claude SDK 安装不完整：未找到 ${legacyCliPath}，也未找到适用于 ${process.platform}-${process.arch} 的原生 Claude CLI。请重新安装依赖后再启动。`;
      }

      executablePath = nativeBinaryPath;
      executableArgs = ['--version'];
    }
  } catch (error) {
    return `未找到 @anthropic-ai/claude-agent-sdk：${error instanceof Error ? error.message : String(error)}`;
  }

  try {
    execFileSync(executablePath, executableArgs, {
      stdio: 'pipe',
      env: {
        ...process.env,
        CLAUDE_CODE_ENTRYPOINT: process.env.CLAUDE_CODE_ENTRYPOINT || 'sdk-ts',
      },
      timeout: 5000,
      windowsHide: process.platform === 'win32',
    });
  } catch (error) {
    const execError = error as Error & { stderr?: Buffer | string };
    const stderr = Buffer.isBuffer(execError.stderr)
      ? execError.stderr.toString('utf-8')
      : execError.stderr;
    const details = stderr?.trim() || execError.message || String(error);
    return `Claude SDK 运行时不可用：${details}`;
  }

  return null;
}

export function parseCommaSeparated(value: string): string[] {
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * 将最新的 Claude 认证环境变量按优先级合并到 process.env。
 * 优先级：shell 环境变量 > 本机 Claude 配置（~/.claude/settings.json，与 Claude Code 共用）>
 * ~/.open-im/config.json 的 tools.claude.env。
 *
 * 设计意图：用户只需维护 ~/.claude/settings.json（与 Claude Code CLI 共用），
 * open-im 自动跟随本地 Claude 配置，无需单独配置。config.json 的 tools.claude.env
 * 仅作为兜底，供没有本地 Claude 安装的场景使用。
 */
export function refreshClaudeEnvToProcess(): void {
  const file = loadFileConfig();
  const claudeToolEnv = (file.tools?.claude?.env ?? {}) as Record<string, string>;
  const claudeSettingsEnv = loadClaudeSettingsEnv();

  for (const key of CLAUDE_AUTH_ENV_KEYS) {
    if (key in originalShellEnv) {
      process.env[key] = originalShellEnv[key];
      continue;
    }
    // 优先读取 ~/.claude/settings.json（与 Claude Code CLI 共用同一配置）
    if (key in claudeSettingsEnv) {
      process.env[key] = claudeSettingsEnv[key];
      continue;
    }
    // 兜底：config.json tools.claude.env（仅在没有本地 Claude 安装时需要）
    if (key in claudeToolEnv) {
      process.env[key] = claudeToolEnv[key];
      continue;
    }
    delete process.env[key];
  }
}
