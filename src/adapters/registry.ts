import { getConfiguredAiCommands, type Config } from '../config.js';
import type { ToolAdapter } from './tool-adapter.interface.js';
import { ClaudeSDKAdapter } from './claude-sdk-adapter.js';
import { CodexAdapter } from './codex-adapter.js';
import { CodeBuddyAdapter } from './codebuddy-adapter.js';
import { OpenCodeAdapter } from './opencode-adapter.js';
import { startOpencode, stopOpencode, isOpencodeRunning } from '../opencode/sdk-manager.js';
import { createLogger } from '../logger.js';
import { destroyAllLiveChildren } from '../shared/process-kill.js';

const log = createLogger('Registry');
const adapters = new Map<string, ToolAdapter>();

/**
 * 工具 id → adapter 工厂的映射。
 * 新增工具在此加一行(id 与 tool-registry 的 id 对应)即可,无需改 initAdapters 逻辑。
 */
const ADAPTER_FACTORIES: Record<string, (config: Config) => ToolAdapter> = {
  claude: () => new ClaudeSDKAdapter(),
  codex: (c) => new CodexAdapter(c.codexCliPath),
  codebuddy: (c) => new CodeBuddyAdapter(c.codebuddyCliPath),
  opencode: () => new OpenCodeAdapter(),
};

export function initAdapters(config: Config): void {
  adapters.clear();
  for (const aiCommand of getConfiguredAiCommands(config)) {
    const factory = ADAPTER_FACTORIES[aiCommand];
    if (!factory) {
      log.warn(`No adapter factory registered for: ${aiCommand}`);
      continue;
    }
    log.info(`${aiCommand} adapter enabled`);
    adapters.set(aiCommand, factory(config));

    // SDK 工具需要懒启动 server，这里先触发预热
    if (aiCommand === 'opencode' && !isOpencodeRunning()) {
      startOpencode().catch((err) => {
        log.warn(`OpenCode SDK server prewarm failed (will retry on first use): ${err}`);
      });
    }
  }
}

export function getAdapter(aiCommand: string): ToolAdapter | undefined {
  return adapters.get(aiCommand);
}

export function cleanupAdapters(): void {
  ClaudeSDKAdapter.destroy();
  // 关闭 opencode SDK server
  stopOpencode();
  // 强制终止仍在运行的 CLI 子进程（Codex/CodeBuddy），避免僵尸 / 孤儿
  destroyAllLiveChildren();
  adapters.clear();
}
