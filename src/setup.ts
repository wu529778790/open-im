/**
 * 首次运行配置引导
 *
 * Web 向导已替代大部分 CLI 交互配置。
 * 本文件仅保留：
 * 1. runInteractiveSetup — 启动 Web 配置页面
 * 2. runClaudeApiSetup — Claude API 凭证配置（写入 ~/.claude/settings.json）
 */

import prompts from 'prompts';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { APP_HOME } from './constants.js';
import { createLogger } from './logger.js';

const log = createLogger('Setup');

const CLAUDE_SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');

function loadClaudeSettings(): Record<string, unknown> {
  if (!existsSync(CLAUDE_SETTINGS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** 检查 ~/.claude/settings.json 中是否已有 API Key 或 Auth Token */
function hasClaudeCredsInSettings(): boolean {
  const s = loadClaudeSettings();
  const env = s?.env as Record<string, unknown> | undefined;
  return !!(env?.ANTHROPIC_API_KEY || env?.ANTHROPIC_AUTH_TOKEN);
}

/**
 * Claude API 专用配置向导，保存到 ~/.claude/settings.json（与 Claude Code 共用）
 */
export async function runClaudeApiSetup(): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.log('\n━━━ Claude API 配置 ━━━\n');
    console.log('当前环境不支持交互输入。请通过 Web 控制台配置：');
    console.log('  1. 运行 open-im start');
    console.log('  2. 打开 http://127.0.0.1:39282');
    console.log('  3. 在设置向导中配置 Claude API\n');
    return false;
  }

  const existing = loadClaudeSettings();
  const existingEnv = (existing.env as Record<string, string>) || {};

  console.log('\n━━━ Claude API 配置向导 ━━━\n');
  console.log('配置将保存到 ~/.claude/settings.json\n');

  const onCancel = () => {
    console.log('\n已取消配置。');
    process.exit(0);
  };

  const apiTypeResp = await prompts(
    {
      type: 'select',
      name: 'apiType',
      message: '选择 API 类型',
      choices: [
        { title: '官方 API（Anthropic）', value: 'official' },
        { title: '第三方模型 / 自定义 API', value: 'thirdparty' },
        { title: '跳过（已在 Web 控制台配置）', value: 'skip' },
      ],
      initial: 0,
    },
    { onCancel },
  );

  if (!apiTypeResp.apiType || apiTypeResp.apiType === 'skip') return false;

  const env: Record<string, string> = { ...existingEnv };

  if (apiTypeResp.apiType === 'official') {
    const keyTypeResp = await prompts(
      {
        type: 'select',
        name: 'keyType',
        message: '选择认证方式',
        choices: [
          { title: 'API Key（sk-ant-...）', value: 'apikey' },
          { title: 'Auth Token（claude setup-token 生成）', value: 'token' },
        ],
        initial: 0,
      },
      { onCancel },
    );

    if (keyTypeResp.keyType === 'apikey') {
      const { default: readline } = await import('node:readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const key = await new Promise<string>((resolve) => {
        rl.question('ANTHROPIC_API_KEY: ', (answer) => {
          rl.close();
          resolve(answer.trim());
        });
      });
      if (!key.trim()) {
        console.log('API Key 不能为空');
        return false;
      }
      env.ANTHROPIC_API_KEY = key.trim();
      delete env.ANTHROPIC_AUTH_TOKEN;
    } else {
      const { default: readline } = await import('node:readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const token = await new Promise<string>((resolve) => {
        rl.question('ANTHROPIC_AUTH_TOKEN: ', (answer) => {
          rl.close();
          resolve(answer.trim());
        });
      });
      if (!token.trim()) {
        console.log('Auth Token 不能为空');
        return false;
      }
      env.ANTHROPIC_AUTH_TOKEN = token.trim();
      delete env.ANTHROPIC_API_KEY;
    }
  } else {
    const { default: readline } = await import('node:readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q: string) => new Promise<string>((resolve) => rl.question(q, (a) => resolve(a.trim())));

    const token = await ask('ANTHROPIC_AUTH_TOKEN（第三方模型 Token）: ');
    if (!token) { console.log('Token 不能为空'); rl.close(); return false; }
    const baseUrl = await ask('ANTHROPIC_BASE_URL（API 地址）: ');
    if (!baseUrl) { console.log('Base URL 不能为空'); rl.close(); return false; }
    const model = await ask('ANTHROPIC_MODEL（模型名称，如 glm-4.7）: ');
    if (!model) { console.log('模型名称不能为空'); rl.close(); return false; }
    rl.close();

    env.ANTHROPIC_AUTH_TOKEN = token;
    env.ANTHROPIC_BASE_URL = baseUrl;
    env.ANTHROPIC_MODEL = model;
    delete env.ANTHROPIC_API_KEY;
  }

  const dir = dirname(CLAUDE_SETTINGS_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const merged = { ...existing, env };
  writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(merged, null, 2), 'utf-8');
  console.log('\n✓ Claude API 配置已保存到', CLAUDE_SETTINGS_PATH);
  return true;
}

/**
 * 交互式配置 — 现在直接引导到 Web 控制台
 */
export async function runInteractiveSetup(): Promise<boolean> {
  console.log('\n━━━ open-im 配置 ━━━\n');
  console.log('请通过 Web 控制台完成配置：');
  console.log('  1. 运行 open-im start');
  console.log('  2. 打开 http://127.0.0.1:39282');
  console.log('  3. 按照设置向导完成配置\n');
  console.log('或运行 open-im dashboard 仅启动 Web 配置服务。\n');
  return true;
}
