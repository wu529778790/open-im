import { getConfiguredAiCommands, type Config } from '../config.js';
import type { ToolAdapter } from './tool-adapter.interface.js';
import { ClaudeSDKAdapter, configureClaudeSdkSessionIdle } from './claude-sdk-adapter.js';
import { CodexAdapter } from './codex-adapter.js';
import { CodeBuddyAdapter } from './codebuddy-adapter.js';
import { OpenCodeAdapter } from './opencode-adapter.js';
import { createLogger } from '../logger.js';
import { destroyAllLiveChildren } from '../shared/process-kill.js';

const log = createLogger('Registry');
const adapters = new Map<string, ToolAdapter>();

export function initAdapters(config: Config): void {
  adapters.clear();
  for (const aiCommand of getConfiguredAiCommands(config)) {
    if (aiCommand === 'claude') {
      log.info('Claude Agent SDK adapter enabled');
      configureClaudeSdkSessionIdle(config.claudeSessionIdleTtlMinutes);
      adapters.set('claude', new ClaudeSDKAdapter());
      continue;
    }

    if (aiCommand === 'codex') {
      log.info('Codex CLI adapter enabled');
      adapters.set('codex', new CodexAdapter(config.codexCliPath));
      continue;
    }

    if (aiCommand === 'codebuddy') {
      log.info('CodeBuddy CLI adapter enabled');
      adapters.set('codebuddy', new CodeBuddyAdapter(config.codebuddyCliPath));
    }

    if (aiCommand === 'opencode') {
      log.info('OpenCode CLI adapter enabled');
      adapters.set('opencode', new OpenCodeAdapter(config.opencodeCliPath));
    }
  }
}

export function getAdapter(aiCommand: string): ToolAdapter | undefined {
  return adapters.get(aiCommand);
}

export function cleanupAdapters(): void {
  ClaudeSDKAdapter.destroy();
  // 强制终止仍在运行的 CLI 子进程（Codex/CodeBuddy），避免僵尸 / 孤儿
  destroyAllLiveChildren();
  adapters.clear();
}
