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

export function AiConfigSection({ ai, onUpdate, t, html, forwardRef, hideHeading = false }: Props) {
  // tab 列表从注册表派生;此前只硬编码了 claude/codex/codebuddy,opencode 无配置入口。
  const [tab, setTab] = useState<AiCommand>("claude");

  return (
    <section className="section" ref={forwardRef as React.RefObject<HTMLElement>}>
      {!hideHeading && (
        <div className="section-head">
          <div>
            <h2 className="section-title">{t("aiTitle")}</h2>
            <p className="section-desc">{t("aiHint")}</p>
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
                <label className="toggle">
                  <input
                    type="checkbox"
                    className="toggle-input"
                    checked={ai.claudeSkipPermissions}
                    onChange={(e) => onUpdate({ claudeSkipPermissions: e.target.checked })}
                  />
                  <span className="toggle-track" />
                  <span className="form-label" style={{ margin: 0 }}>{t("claudeSkipPermissions")}</span>
                </label>
                <p className="field-tip">{t("claudeSkipPermissionsTip")}</p>
              </div>
              <div className="form-group">
                <label className="form-label">{t("claudeProxy")}</label>
                <input className="form-input mono" value={ai.claudeProxy} onChange={(e) => onUpdate({ claudeProxy: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">{t("claudeConfigPath")}</label>
                <input className="form-input mono" readOnly style={{ background: "var(--c-surface-alt)" }} value={ai.claudeConfigPath} />
              </div>
            </>
          )}
          {tab === "codex" && (
            <>
              <div className="form-group">
                <label className="form-label">{t("codexApiKey")}</label>
                <input className="form-input mono" type="password" value={ai.codexApiKey ?? ""} onChange={(e) => onUpdate({ codexApiKey: e.target.value })} />
                <p className="field-tip" dangerouslySetInnerHTML={{ __html: t("codexApiKeyTip") }} />
              </div>
              <div className="form-group">
                <label className="form-label">{t("codexCli")}</label>
                <input className="form-input mono" value={ai.codexCliPath} onChange={(e) => onUpdate({ codexCliPath: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">{t("codexProxy")}</label>
                <input className="form-input mono" value={ai.codexProxy} onChange={(e) => onUpdate({ codexProxy: e.target.value })} />
              </div>
            </>
          )}
          {tab === "codebuddy" && (
            <div className="form-group">
              <label className="form-label">{t("codebuddyCli")}</label>
              <input className="form-input mono" value={ai.codebuddyCliPath} onChange={(e) => onUpdate({ codebuddyCliPath: e.target.value })} />
            </div>
          )}
          {tab === "opencode" && (
            <div className="form-group">
              <p className="field-tip" style={{ margin: 0 }}>{t("opencodeSdkInfo")}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
