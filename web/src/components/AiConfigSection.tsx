import { useState } from "react";
import type { WebConfigPayload } from "../types.js";
import { AI_TOOL_DEFINITIONS, type AiCommand } from "../tool-definitions.js";

interface Props {
  ai: WebConfigPayload["ai"];
  onUpdate: (patch: Partial<WebConfigPayload["ai"]>) => void;
  t: (k: string) => string;
  html: (k: string) => string;
  forwardRef?: React.RefObject<HTMLElement | null>;
  hideHeading?: boolean;
}

export function AiConfigSection({ ai, onUpdate, forwardRef, hideHeading = false }: Props) {
  // tab 列表从注册表派生;此前只硬编码了 claude/codex/codebuddy,opencode 无配置入口。
  const [tab, setTab] = useState<AiCommand>("claude");

  return (
    <section className="section" ref={forwardRef as React.RefObject<HTMLElement>}>
      {!hideHeading && (
        <div className="section-head">
          <div>
            <h2 className="section-title">{"AI 工具配置"}</h2>
            <p className="section-desc">{"Claude SDK：左侧栏「配置文件」→ ~/.claude/settings.json。各渠道用哪个 AI 在上方「平台」里分别设置。若任一平台选 Codex/CodeBuddy，再在下方填对应 CLI 路径。"}</p>
          </div>
        </div>
      )}
      <div className="card">
        <div className="card-head">
          <div className="tabs">
            {AI_TOOL_DEFINITIONS.map((tool) => (
              <button key={tool.key} type="button" className={`tab ${tab === tool.key ? "active" : ""}`} onClick={() => setTab(tool.key)}>
                {tool.label}
              </button>
            ))}
          </div>
        </div>
        <div className="card-body">
          {tab === "claude" && (
            <>
              <div className="form-group">
                <label className="form-label">{"代理（可选）"}</label>
                <input className="form-input mono" value={ai.claudeProxy} onChange={(e) => onUpdate({ claudeProxy: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">{"配置文件位置"}</label>
                <input className="form-input mono" readOnly style={{ background: "var(--c-surface-alt)" }} value={ai.claudeConfigPath} />
              </div>
            </>
          )}
          {tab === "codex" && (
            <>
              <div className="form-group">
                <label className="form-label">{"OPENAI_API_KEY"}</label>
                <input className="form-input mono" type="password" value={ai.codexApiKey ?? ""} onChange={(e) => onUpdate({ codexApiKey: e.target.value })} />
                <p className="field-tip" dangerouslySetInnerHTML={{ __html: "设置 Codex 使用的 OpenAI API Key。也可以在下方编辑 auth 文件。" }} />
              </div>
              <div className="form-group">
                <label className="form-label">{"Codex CLI 路径"}</label>
                <input className="form-input mono" value={ai.codexCliPath} onChange={(e) => onUpdate({ codexCliPath: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">{"Codex 代理"}</label>
                <input className="form-input mono" value={ai.codexProxy} onChange={(e) => onUpdate({ codexProxy: e.target.value })} />
              </div>
            </>
          )}
          {tab === "codebuddy" && (
            <div className="form-group">
              <label className="form-label">{"CodeBuddy CLI 路径"}</label>
              <input className="form-input mono" value={ai.codebuddyCliPath} onChange={(e) => onUpdate({ codebuddyCliPath: e.target.value })} />
            </div>
          )}
          {tab === "opencode" && (
            <div className="form-group">
              <p className="field-tip" style={{ margin: 0 }}>{"OpenCode 使用 SDK 集成，无需配置 CLI 路径。"}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
