import type { AiCommand } from "../types.js";
import { AI_TOOL_DEFINITIONS } from "../tool-definitions.js";

interface AiCommandPickerProps {
  value: AiCommand;
  onChange: (v: AiCommand) => void;
  t: (k: string) => string;
}

/**
 * 平台卡片顶部的 AI 工具选择区块。
 * 把"这个渠道用什么 AI 回复"提升为视觉层级最高的字段，
 * 传达"每个渠道独立配置 AI"的心智模型。
 */
export function AiCommandPicker({ value, onChange, t }: AiCommandPickerProps) {
  return (
    <div className="ai-command-picker">
      <div className="ai-command-picker-title">{t("aiCommandPickerTitle")}</div>
      <div className="ai-command-picker-hint">{t("aiCommandPickerHint")}</div>
      <select
        className="form-select"
        value={String(value || "claude")}
        onChange={(e) => onChange(e.target.value as AiCommand)}
      >
        {AI_TOOL_DEFINITIONS.map((tool) => (
          <option key={tool.key} value={tool.key}>
            {tool.label}
          </option>
        ))}
      </select>
    </div>
  );
}
