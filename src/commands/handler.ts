import { resolvePlatformAiCommand, type Config, type Platform } from '../config.js';
import type { SessionManager } from '../session/session-manager.js';
import type { RequestQueue } from '../queue/request-queue.js';
import { escapePathForMarkdown } from '../shared/utils.js';
import { TERMINAL_ONLY_COMMANDS } from '../constants.js';
import { createLogger } from '../logger.js';
import { markSkipAutoResume } from '../adapters/claude-sdk-adapter.js';

const log = createLogger('Commands');
import { AsyncLocalStorage } from 'node:async_hooks';
import { execFile } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ThreadContext } from '../shared/types.js';

export type { ThreadContext };

export interface MessageSender {
  sendTextReply(chatId: string, text: string, threadCtx?: ThreadContext): Promise<void>;
  sendDirectorySelection?(chatId: string, currentDir: string, userId: string): Promise<void>;
}

export interface CommandHandlerDeps {
  config: Config;
  sessionManager: SessionManager;
  requestQueue: RequestQueue;
  sender: MessageSender;
  getRunningTasksSize: () => number;
}

export type ClaudeRequestHandler = (
  userId: string,
  chatId: string,
  prompt: string,
  workDir: string,
  convId?: string,
  threadCtx?: ThreadContext,
  replyToMessageId?: string
) => Promise<void>;

/**
 * Telegram 群聊等场景下命令常为 `/new@BotName`，需与 `/new` 等价。
 * 仅去掉「第一个」命令词上的 `@suffix`，保留 `/resume 1` 等参数。
 */
/** 并发 dispatch 时，用 AsyncLocalStorage 绑定「本条消息」的 sender（如 WorkBuddy 需 msgId）。 */
const commandReplySender = new AsyncLocalStorage<MessageSender>();

function mergeMessageSender(override: MessageSender, base: MessageSender): MessageSender {
  return {
    sendTextReply: (chatId, text, threadCtx?) =>
      override.sendTextReply(chatId, text, threadCtx),
    sendDirectorySelection: override.sendDirectorySelection ?? base.sendDirectorySelection,
  };
}

export function normalizeSlashCommandForDispatch(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/") || !trimmed.includes("@")) return trimmed;
  const firstSpace = trimmed.indexOf(" ");
  const firstSegment = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
  if (!firstSegment.includes("@")) return trimmed;
  const at = firstSegment.indexOf("@");
  const baseCmd = firstSegment.slice(0, at);
  if (firstSpace === -1) return baseCmd;
  return `${baseCmd}${trimmed.slice(firstSpace)}`;
}

export class CommandHandler {
  constructor(private deps: CommandHandlerDeps) {}

  private replySender(): MessageSender {
    return commandReplySender.getStore() ?? this.deps.sender;
  }

  async dispatch(
    text: string,
    chatId: string,
    userId: string,
    platform: Platform,
    _handleClaudeRequest: ClaudeRequestHandler,
    /** 若提供，本条消息的斜杠命令回复走此 sender（须与 handleTextFlow 的 sendTextReply 一致，如带 msgId）。 */
    senderOverride?: MessageSender,
  ): Promise<boolean> {
    const runBody = async (): Promise<boolean> => {
      const t = normalizeSlashCommandForDispatch(text);

      if (platform === 'telegram' && t === '/start') {
        await this.replySender().sendTextReply(chatId, '欢迎使用 open-im AI CLI 桥接！\n\n发送消息与 AI 交互，输入 /help 查看帮助。');
        return true;
      }

      if (t === '/help') return this.handleHelp(chatId);
      if (t === '/new') return this.handleNew(chatId, userId);
      if (t === '/sessions' || t === '/resume') return this.handleSessions(chatId, userId, platform);
      if (t.startsWith('/resume ')) return this.handleResume(chatId, userId, t.slice(8).trim(), platform);
      if (t === '/pwd') return this.handlePwd(chatId, userId);
      if (t === '/status') return this.handleStatus(chatId, userId, platform);

      if (t === '/cd' || t.startsWith('/cd ')) {
        return this.handleCd(chatId, userId, t.slice(3).trim(), platform);
      }

      const cmd = t.split(/\s+/)[0];
      if (TERMINAL_ONLY_COMMANDS.has(cmd)) {
        await this.replySender().sendTextReply(chatId, `${cmd} 命令仅在终端可用。`);
        return true;
      }

      return false;
    };

    if (senderOverride) {
      return commandReplySender.run(mergeMessageSender(senderOverride, this.deps.sender), runBody);
    }
    return runBody();
  }

  private async handleHelp(chatId: string): Promise<boolean> {
    const help = [
      '📋 可用命令:',
      '',
      '/help - 显示帮助',
      '/new - 开始新会话（AI 上下文重置）',
      '/sessions - 查看历史会话',
      '/resume <序号> - 恢复历史会话',
      '/status - 显示状态',
      '/cd <路径> - 切换工作目录',
      '/pwd - 当前工作目录',
    ].join('\n');
    await this.replySender().sendTextReply(chatId, help);
    return true;
  }

  private async handleSessions(chatId: string, userId: string, _platform: Platform): Promise<boolean> {
    const history = this.deps.sessionManager.listConvHistory(userId);
    const active = this.deps.sessionManager.getActiveConvInfo(userId);

    if (history.length === 0 && !active) {
      await this.replySender().sendTextReply(chatId, '📋 暂无会话记录。');
      return true;
    }

    const lines = ['📋 会话列表:', ''];
    history.forEach((entry, i) => {
      lines.push(`${i + 1}. ${entry.convId} · ${entry.totalTurns}轮`);
    });
    if (active) {
      const num = history.length + 1;
      lines.push(`▸ ${num}. ${active.convId} · ${active.totalTurns}轮（当前）`);
    }

    lines.push('', '使用 /resume <序号> 恢复历史会话');
    await this.replySender().sendTextReply(chatId, lines.join('\n'));
    return true;
  }

  private async handleResume(chatId: string, userId: string, arg: string, _platform: Platform): Promise<boolean> {
    const index = parseInt(arg, 10);
    if (isNaN(index) || index < 1) {
      await this.replySender().sendTextReply(chatId, '用法: /resume <序号>\n\n使用 /sessions 查看会话列表。');
      return true;
    }

    const history = this.deps.sessionManager.listConvHistory(userId);
    if (index > history.length) {
      await this.replySender().sendTextReply(chatId, `序号 ${index} 无效，共 ${history.length} 个历史会话。`);
      return true;
    }

    const entry = history[index - 1];
    this.deps.requestQueue.cancelUser(userId);
    const ok = this.deps.sessionManager.resumeConv(userId, entry.convId);
    if (ok) {
      await this.replySender().sendTextReply(
        chatId,
        `✅ 已恢复会话 ${index} (${entry.convId})，共 ${entry.totalTurns}轮对话。\n继续发消息即可。`
      );
    } else {
      await this.replySender().sendTextReply(chatId, '❌ 恢复会话失败，请重试。');
    }
    return true;
  }

  private async handleNew(chatId: string, userId: string): Promise<boolean> {
    this.deps.requestQueue.cancelUser(userId);
    const workDir = this.deps.sessionManager.getWorkDir(userId);
    markSkipAutoResume(workDir);
    const ok = this.deps.sessionManager.newSession(userId);
    await this.replySender().sendTextReply(
      chatId,
      ok
        ? '✅ AI 会话已重置，下一条消息将使用全新上下文。'
        : '当前没有活动会话。'
    );
    return true;
  }

  private async handlePwd(chatId: string, userId: string): Promise<boolean> {
    const workDir = this.deps.sessionManager.getWorkDir(userId);
    await this.replySender().sendTextReply(chatId, `当前工作目录: ${escapePathForMarkdown(workDir)}`);
    return true;
  }

  private async handleStatus(chatId: string, userId: string, platform: Platform): Promise<boolean> {
    const aiCommand = resolvePlatformAiCommand(this.deps.config, platform);
    const version = await this.getAiVersion(aiCommand);
    const workDir = this.deps.sessionManager.getWorkDir(userId);
    const convId = this.deps.sessionManager.getConvId(userId);
    const sessionId = this.deps.sessionManager.getSessionIdForConv(userId, convId, aiCommand);
    const lines = [
      '📊 状态:',
      '',
      `AI 工具: ${aiCommand}`,
      `版本: ${version}`,
      `工作目录: ${escapePathForMarkdown(workDir)}`,
      `会话: ${sessionId ?? '无'}`,
    ];
    await this.replySender().sendTextReply(chatId, lines.join('\n'));
    return true;
  }

  private async handleCd(chatId: string, userId: string, dir: string, _platform: Platform): Promise<boolean> {
    // 如果 dir 为空，显示目录选择界面
    if (!dir) {
      const currentDir = this.deps.sessionManager.getWorkDir(userId);
      const s = this.replySender();
      if (s.sendDirectorySelection) {
        await s.sendDirectorySelection(chatId, currentDir, userId);
      } else {
        await s.sendTextReply(
          chatId,
          `当前目录: ${escapePathForMarkdown(currentDir)}\n使用 /cd <路径> 切换`
        );
      }
      return true;
    }
    try {
      this.deps.requestQueue.cancelUser(userId);
      const resolved = await this.deps.sessionManager.setWorkDir(userId, dir);
      await this.replySender().sendTextReply(
        chatId,
        `📁 工作目录已切换到: ${escapePathForMarkdown(resolved)}\n\n` +
        `🔄 AI 会话已重置，下一条消息将使用全新上下文。`
      );
    } catch (err) {
      await this.replySender().sendTextReply(chatId, err instanceof Error ? err.message : String(err));
    }
    return true;
  }

  private getAiVersion(aiCommand: 'claude' | 'codex' | 'codebuddy'): Promise<string> {
    if (aiCommand === 'claude') {
      // Claude 使用 SDK，返回 SDK 版本
      return Promise.resolve('SDK Mode');
    }
    const cmd = aiCommand === 'codex'
      ? this.deps.config.codexCliPath
      : this.deps.config.codebuddyCliPath;
    return new Promise((resolve) => {
      execFile(cmd, ['--version'], { timeout: 5000 }, (err, stdout) => {
        resolve(err ? '未知' : (stdout?.toString().trim() || '未知'));
      });
    });
  }
}

/**
 * 列出目录并返回目录信息
 */
export function listDirectories(basePath: string): { name: string; fullPath: string; isParent: boolean }[] {
  const dirs: { name: string; fullPath: string; isParent: boolean }[] = [];

  try {
    // 添加返回上级目录选项（如果不是根目录）
    const parent = dirname(basePath);
    if (parent !== basePath) {
      dirs.push({ name: '🔙 返回上级', fullPath: parent, isParent: true });
    }

    // 读取子目录
    const entries = readdirSync(basePath, { withFileTypes: true });
    const subDirs = entries
      .filter((entry) => entry.isDirectory())
      .filter((entry) => !entry.name.startsWith('.')) // 过滤隐藏目录
      .map((entry) => ({
        name: entry.name,
        fullPath: join(basePath, entry.name),
        isParent: false,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)); // 按名称排序

    dirs.push(...subDirs);
  } catch (err) {
    log.debug('Failed to list subdirectories:', err);
  }

  return dirs;
}

/**
 * 生成目录选择的按钮布局
 */
export function buildDirectoryKeyboard(
  directories: { name: string; fullPath: string; isParent: boolean }[],
  userId: string
): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
  const buttons: Array<Array<{ text: string; callback_data: string }>> = [];

  // 每行 2 个按钮
  for (let i = 0; i < directories.length; i += 2) {
    const row: Array<{ text: string; callback_data: string }> = [];
    row.push({
      text: directories[i].name,
      callback_data: `cd:${userId}:${encodeURIComponent(directories[i].fullPath)}`,
    });

    if (i + 1 < directories.length) {
      row.push({
        text: directories[i + 1].name,
        callback_data: `cd:${userId}:${encodeURIComponent(directories[i + 1].fullPath)}`,
      });
    }

    buttons.push(row);
  }

  return { inline_keyboard: buttons };
}
