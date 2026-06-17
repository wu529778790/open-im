import { resolvePlatformAiCommand, type Config, type Platform } from '../config.js';
import type { SessionManager } from '../session/session-manager.js';
import type { RequestQueue } from '../queue/request-queue.js';
import { escapePathForMarkdown } from '../shared/utils.js';
import { TERMINAL_ONLY_COMMANDS } from '../constants.js';
import { createLogger } from '../logger.js';
import { ClaudeSDKAdapter } from '../adapters/claude-sdk-adapter.js';
import type { SDKSessionInfo } from '@anthropic-ai/claude-agent-sdk';

const log = createLogger('Commands');

function formatRelativeTime(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return '刚刚';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}小时前`;
  const day = Math.floor(hr / 24);
  if (day === 1) return '昨天';
  if (day < 30) return `${day}天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

function truncateSummary(session: SDKSessionInfo, maxLen = 30): string {
  const text = session.customTitle || session.summary || session.firstPrompt || '新会话';
  const firstLine = text.split('\n')[0].trim();
  return firstLine.length > maxLen ? firstLine.slice(0, maxLen) + '...' : firstLine;
}
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
      if (t.startsWith('/history')) return this.handleHistory(chatId, userId, t.slice(8).trim());
      if (t.startsWith('/delete ')) return this.handleDelete(chatId, userId, t.slice(8).trim());
      if (t.startsWith('/rename ')) return this.handleRename(chatId, userId, t.slice(8).trim());
      if (t.startsWith('/fork')) return this.handleFork(chatId, userId, t.slice(5).trim());
      if (t === '/models') return this.handleModels(chatId, userId, platform);
      if (t === '/context') return this.handleContext(chatId, userId, platform);
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
      '/resume [序号] - 恢复历史会话（无参数恢复最近一条）',
      '/history [序号] - 查看会话对话记录',
      '/delete <序号> - 删除历史会话',
      '/rename <标题> - 重命名当前会话',
      '/fork [序号] - 分支会话（创建副本）',
      '/models - 查看可用模型',
      '/context - 查看上下文窗口占用',
      '/status - 显示状态',
      '/cd <路径> - 切换工作目录',
      '/pwd - 当前工作目录',
    ].join('\n');
    await this.replySender().sendTextReply(chatId, help);
    return true;
  }

  private async handleSessions(chatId: string, userId: string, _platform: Platform): Promise<boolean> {
    const workDir = this.deps.sessionManager.getWorkDir(userId);
    const sessions = await ClaudeSDKAdapter.listSessionsForDir(workDir);

    if (sessions.length === 0) {
      await this.replySender().sendTextReply(chatId, '📋 暂无会话记录。');
      return true;
    }

    const lines = ['📋 会话列表:', ''];
    sessions.forEach((session, i) => {
      const preview = truncateSummary(session);
      const time = session.lastModified ? ` · ${formatRelativeTime(session.lastModified)}` : '';
      lines.push(`${i + 1}. ${preview}${time}`);
    });

    lines.push('', '使用 /resume <序号> 恢复，或 /resume 恢复最近一条');
    await this.replySender().sendTextReply(chatId, lines.join('\n'));
    return true;
  }

  private async handleResume(chatId: string, userId: string, arg: string, _platform: Platform): Promise<boolean> {
    const workDir = this.deps.sessionManager.getWorkDir(userId);
    const sessions = await ClaudeSDKAdapter.listSessionsForDir(workDir);

    // /resume (no arg) — resume the most recent session
    if (!arg) {
      if (sessions.length === 0) {
        await this.replySender().sendTextReply(chatId, '没有可恢复的历史会话。');
        return true;
      }
      const session = sessions[0];
      this.deps.requestQueue.cancelUser(userId);
      this.deps.sessionManager.setActiveSessionId(userId, session.sessionId);
      const preview = truncateSummary(session);
      await this.replySender().sendTextReply(
        chatId,
        `✅ 已恢复最近会话: ${preview}\n继续发消息即可。`
      );
      return true;
    }

    const index = parseInt(arg, 10);
    if (isNaN(index) || index < 1) {
      await this.replySender().sendTextReply(chatId, '用法: /resume [序号]\n\n不带序号则恢复最近一条会话。');
      return true;
    }

    if (index > sessions.length) {
      await this.replySender().sendTextReply(chatId, `序号 ${index} 无效，共 ${sessions.length} 个历史会话。`);
      return true;
    }

    const session = sessions[index - 1];
    this.deps.requestQueue.cancelUser(userId);
    this.deps.sessionManager.setActiveSessionId(userId, session.sessionId);
    const preview = truncateSummary(session);
    await this.replySender().sendTextReply(
      chatId,
      `✅ 已恢复会话: ${preview}\n继续发消息即可。`
    );
    return true;
  }

  private async handleNew(chatId: string, userId: string): Promise<boolean> {
    this.deps.requestQueue.cancelUser(userId);
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

    // 账号信息（仅 claude）
    if (aiCommand === 'claude') {
      try {
        const account = await ClaudeSDKAdapter.getAccountInfo(workDir);
        if (account) {
          lines.push('', '👤 账号:');
          if (account.email) lines.push(`邮箱: ${account.email}`);
          if (account.organization) lines.push(`组织: ${account.organization}`);
        }
      } catch { /* ignore */ }
    }

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
      const result = await this.deps.sessionManager.setWorkDir(userId, dir);
      await this.replySender().sendTextReply(
        chatId,
        `📁 工作目录已切换到: ${escapePathForMarkdown(result.path)}\n\n下一条消息将自动查找该目录的最近会话。`
      );
    } catch (err) {
      await this.replySender().sendTextReply(chatId, err instanceof Error ? err.message : String(err));
    }
    return true;
  }

  private async handleHistory(chatId: string, userId: string, arg: string): Promise<boolean> {
    const workDir = this.deps.sessionManager.getWorkDir(userId);
    const sessions = await ClaudeSDKAdapter.listSessionsForDir(workDir);

    if (sessions.length === 0) {
      await this.replySender().sendTextReply(chatId, '暂无会话记录。');
      return true;
    }

    let targetSession = sessions[0]; // 默认当前/最近会话
    if (arg) {
      const index = parseInt(arg, 10);
      if (isNaN(index) || index < 1 || index > sessions.length) {
        await this.replySender().sendTextReply(chatId, `序号无效，共 ${sessions.length} 个会话。`);
        return true;
      }
      targetSession = sessions[index - 1];
    }

    const messages = await ClaudeSDKAdapter.getSessionMessagesForId(targetSession.sessionId, workDir, 30);
    if (messages.length === 0) {
      await this.replySender().sendTextReply(chatId, '该会话暂无对话记录。');
      return true;
    }

    const preview = truncateSummary(targetSession);
    const lines = [`📜 会话记录: ${preview}`, ''];
    for (const msg of messages) {
      if (msg.type === 'system') continue;
      const m = msg.message as Record<string, unknown> | undefined;
      let text = '';
      if (typeof m === 'string') {
        text = m;
      } else if (m && typeof m === 'object') {
        const content = m.content;
        if (Array.isArray(content) && content[0]?.text) {
          text = content[0].text;
        } else if (typeof content === 'string') {
          text = content;
        }
      }
      if (!text) continue;
      const prefix = msg.type === 'user' ? '👤' : '🤖';
      lines.push(`${prefix} ${text.slice(0, 200)}`);
    }

    await this.replySender().sendTextReply(chatId, lines.join('\n'));
    return true;
  }

  private async handleDelete(chatId: string, userId: string, arg: string): Promise<boolean> {
    const workDir = this.deps.sessionManager.getWorkDir(userId);
    const sessions = await ClaudeSDKAdapter.listSessionsForDir(workDir);

    const index = parseInt(arg, 10);
    if (isNaN(index) || index < 1 || index > sessions.length) {
      await this.replySender().sendTextReply(chatId, `用法: /delete <序号>\n共 ${sessions.length} 个会话。`);
      return true;
    }

    const session = sessions[index - 1];
    const preview = truncateSummary(session);
    const ok = await ClaudeSDKAdapter.deleteSessionById(session.sessionId, workDir);
    await this.replySender().sendTextReply(
      chatId,
      ok ? `✅ 已删除会话: ${preview}` : `❌ 删除失败`
    );
    return true;
  }

  private async handleRename(chatId: string, userId: string, title: string): Promise<boolean> {
    if (!title) {
      await this.replySender().sendTextReply(chatId, '用法: /rename <新标题>');
      return true;
    }

    const workDir = this.deps.sessionManager.getWorkDir(userId);
    const convId = this.deps.sessionManager.getConvId(userId);
    const aiCommand: 'claude' | 'codex' | 'codebuddy' | 'opencode' = 'claude';
    const sessionId = this.deps.sessionManager.getSessionIdForConv(userId, convId, aiCommand);

    if (!sessionId) {
      await this.replySender().sendTextReply(chatId, '当前没有活动会话。');
      return true;
    }

    const ok = await ClaudeSDKAdapter.renameSessionById(sessionId, title, workDir);
    await this.replySender().sendTextReply(
      chatId,
      ok ? `✅ 会话已重命名为: ${title}` : '❌ 重命名失败'
    );
    return true;
  }

  private async handleFork(chatId: string, userId: string, arg: string): Promise<boolean> {
    const workDir = this.deps.sessionManager.getWorkDir(userId);
    const sessions = await ClaudeSDKAdapter.listSessionsForDir(workDir);

    if (sessions.length === 0) {
      await this.replySender().sendTextReply(chatId, '暂无会话可分支。');
      return true;
    }

    let targetSession = sessions[0];
    if (arg) {
      const index = parseInt(arg, 10);
      if (isNaN(index) || index < 1 || index > sessions.length) {
        await this.replySender().sendTextReply(chatId, `序号无效，共 ${sessions.length} 个会话。`);
        return true;
      }
      targetSession = sessions[index - 1];
    }

    const newSessionId = await ClaudeSDKAdapter.forkSessionById(targetSession.sessionId, workDir);
    if (newSessionId) {
      this.deps.sessionManager.setActiveSessionId(userId, newSessionId);
      const preview = truncateSummary(targetSession);
      await this.replySender().sendTextReply(
        chatId,
        `✅ 已分支会话: ${preview}\n新会话 ID: ${newSessionId.slice(0, 8)}...\n继续发消息即可。`
      );
    } else {
      await this.replySender().sendTextReply(chatId, '❌ 分支失败');
    }
    return true;
  }

  private async handleModels(chatId: string, userId: string, _platform: Platform): Promise<boolean> {
    const workDir = this.deps.sessionManager.getWorkDir(userId);
    const models = await ClaudeSDKAdapter.getSupportedModels(workDir);

    if (models.length === 0) {
      await this.replySender().sendTextReply(chatId, '暂无可用模型信息。');
      return true;
    }

    const lines = ['🤖 可用模型:', ''];
    for (const model of models) {
      const name = model.displayName || model.value;
      const desc = model.description ? ` - ${model.description.slice(0, 60)}` : '';
      lines.push(`• ${name}${desc}`);
    }

    await this.replySender().sendTextReply(chatId, lines.join('\n'));
    return true;
  }

  private async handleContext(chatId: string, userId: string, _platform: Platform): Promise<boolean> {
    const workDir = this.deps.sessionManager.getWorkDir(userId);
    const usage = await ClaudeSDKAdapter.getContextUsage(workDir);

    if (!usage) {
      await this.replySender().sendTextReply(chatId, '暂无上下文信息。');
      return true;
    }

    const lines = ['📏 上下文窗口占用:', ''];
    if (usage.model) lines.push(`模型: ${usage.model}`);
    if (usage.totalTokens) lines.push(`已用: ${usage.totalTokens.toLocaleString()} tokens`);
    if (usage.maxTokens) lines.push(`上限: ${usage.maxTokens.toLocaleString()} tokens`);
    if (usage.percentage != null) lines.push(`使用率: ${usage.percentage}%`);

    if (usage.categories?.length) {
      lines.push('', '分类:');
      for (const cat of usage.categories) {
        if (cat.tokens > 0) {
          lines.push(`  ${cat.name}: ${cat.tokens.toLocaleString()}`);
        }
      }
    }

    await this.replySender().sendTextReply(chatId, lines.join('\n'));
    return true;
  }

  private getAiVersion(aiCommand: 'claude' | 'codex' | 'codebuddy' | 'opencode'): Promise<string> {
    if (aiCommand === 'claude') {
      return Promise.resolve('SDK Mode');
    }
    const cmd = aiCommand === 'codex'
      ? this.deps.config.codexCliPath
      : aiCommand === 'opencode'
        ? this.deps.config.opencodeCliPath
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
