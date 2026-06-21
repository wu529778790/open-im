/**
 * AI 工具定义注册表 — 前端版的真相源,对标 PLATFORM_DEFINITIONS。
 *
 * 新增一个 AI 工具只需在此数组加一条,AiCommand 类型、下拉选项、配置 tab
 * 均自动派生,无需逐个组件手改。
 *
 * 与后端 src/adapters/tool-registry.ts 保持同构。
 */

export interface ToolDefinition {
  /** 工具 id,即 aiCommand 取值 */
  key: string;
  /** 下拉/标签显示文本 */
  label: string;
  /** 是否在 AI 配置区有独立 tab(Claude/Codex/CodeBuddy 有,opencode 暂仅 CLI 路径) */
  hasConfigTab?: boolean;
}

export const AI_TOOL_DEFINITIONS = [
  { key: "claude" as const, label: "Claude Code", hasConfigTab: true },
  { key: "codex" as const, label: "Codex", hasConfigTab: true },
  { key: "codebuddy" as const, label: "CodeBuddy", hasConfigTab: true },
  { key: "opencode" as const, label: "OpenCode", hasConfigTab: true },
] as const satisfies readonly ToolDefinition[];

/** 全部工具 key,用于派生类型与遍历 */
export const AI_TOOL_KEYS = AI_TOOL_DEFINITIONS.map((t) => t.key) as readonly string[];

/** aiCommand 的合法取值(含空串,前端未选择态) */
export type AiCommand = "" | (typeof AI_TOOL_DEFINITIONS)[number]["key"];

/** 值是否为已注册工具(不含空串) */
export function isAiCommand(value: unknown): value is (typeof AI_TOOL_DEFINITIONS)[number]["key"] {
  return typeof value === "string" && AI_TOOL_KEYS.includes(value);
}
