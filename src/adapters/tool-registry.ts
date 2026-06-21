/**
 * AI 工具注册表 — 数据驱动的工具定义,消除散落在各处的
 * `'claude' | 'codex' | 'codebuddy' | 'opencode'` 字面量联合。
 *
 * 新增一个 AI 工具只需在此数组加一条,`AiCommand` 类型、验证函数、
 * 显示名映射均自动派生。
 *
 * 与前端 `web/src/tool-definitions.ts` 保持同构(后者面向 UI)。
 */

/**
 * 单个 AI 工具的定义。
 */
export interface ToolDefinition {
  /** 工具唯一标识,即 config.json 里 `platforms.*.aiCommand` 的取值 */
  id: string;
  /** 人类可读名称(用于通知、/status 等) */
  label: string;
  /**
   * 进程内 SDK(Claude) vs spawn 的 CLI(其余)。
   * 决定 registry 是否传 cliPath、handler 的 /version 是否查 CLI 路径。
   */
  isSdk?: boolean;
  /** Config 中存放 CLI 路径的字段名(cliDefault 为空时该字段也用于 Windows .cmd 解析) */
  cliPathField?: 'codexCliPath' | 'codebuddyCliPath' | 'opencodeCliPath';
  /** CLI 默认可执行名(非绝对路径时作为 PATH 查找名) */
  cliDefault?: string;
  /** 是否支持 HTTP/HTTPS 代理(目前仅 codex) */
  needsProxy?: boolean;
}

/**
 * 全部已注册的 AI 工具。新增工具在此追加一条即可。
 */
export const AI_TOOLS: readonly ToolDefinition[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    isSdk: true,
  },
  {
    id: 'codex',
    label: 'Codex',
    cliPathField: 'codexCliPath',
    cliDefault: 'codex',
    needsProxy: true,
  },
  {
    id: 'codebuddy',
    label: 'CodeBuddy',
    cliPathField: 'codebuddyCliPath',
    cliDefault: 'codebuddy',
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    cliPathField: 'opencodeCliPath',
    cliDefault: 'opencode',
  },
];

/** 全部工具 id 的字面量元组,用于派生 `AiCommand` 联合类型 */
export const AI_TOOL_IDS = Object.freeze(AI_TOOLS.map((t) => t.id)) as {
  readonly [K in keyof typeof AI_TOOLS]: ToolDefinition['id'];
} & readonly string[];

/**
 * AI 工具命令的联合类型。
 * 从 `AI_TOOLS` 派生,而非手写字面量,保证注册表是唯一真相源。
 */
export type AiCommand = (typeof AI_TOOLS)[number]['id'];

/** 按 id 索引的工具定义映射 */
export const AI_TOOL_BY_ID: Readonly<Record<string, ToolDefinition>> = Object.freeze(
  Object.fromEntries(AI_TOOLS.map((t) => [t.id, t])),
);

/**
 * 值是否为已注册的 AI 命令。
 */
export function isAiCommand(value: unknown): value is AiCommand {
  return typeof value === 'string' && value in AI_TOOL_BY_ID;
}

/**
 * 规范化为合法 AiCommand;非法值回落到 fallback。
 * 收敛此前散落在 config.ts / file-io.ts / config-web.ts / setup.ts 的重复实现。
 */
export function normalizeAiCommand(value: unknown, fallback: AiCommand): AiCommand {
  return isAiCommand(value) ? value : fallback;
}
