import { useState } from "react";
import type { WebConfigPayload } from "../types.js";

interface Props {
  ai: WebConfigPayload["ai"];
  onUpdate: (patch: Partial<WebConfigPayload["ai"]>) => void;
  t: (k: string) => string;
  html: (k: string) => string;
  forwardRef?: React.RefObject<HTMLElement | null>;
}

export function AiConfigSection({ ai, onUpdate, t, forwardRef }: Props) {
  const [tab, setTab] = useState<"claude" | "codex" | "codebuddy">("claude");

  return (
    <section className="section" ref={forwardRef as React.RefObject<HTMLElement>}>
      <div className="section-head">
        <div>
          <h2 className="section-title">{t("aiTitle")}</h2>
          <p className="section-desc">{t("aiHint")}</p>
        </div>
      </div>
      <div className="ai-grid">
        <div className="card">
          <div className="card-head">
            <span className="card-title">{t("aiCommonTitle")}</span>
          </div>
          <div className="card-body">
            <p className="form-hint" style={{ marginBottom: 14 }}>{t("aiPerPlatformHint")}</p>
            <div className="form-group">
              <label className="form-label">{t("workDir")}</label>
              <input className="form-input mono" value={ai.claudeWorkDir} onChange={(e) => onUpdate({ claudeWorkDir: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">{t("hookPort")}</label>
              <input type="number" min={1} className="form-input" value={ai.hookPort || ""} onChange={(e) => onUpdate({ hookPort: Number(e.target.value) || 0 })} />
            </div>
            <div className="form-group">
              <label className="form-label">{t("logLevel")}</label>
              <select className="form-select" value={ai.logLevel} onChange={(e) => onUpdate({ logLevel: e.target.value })}>
                <option value="default">{t("logLevelDefault")}</option>
                <option value="DEBUG">DEBUG</option>
                <option value="INFO">INFO</option>
                <option value="WARN">WARN</option>
                <option value="ERROR">ERROR</option>
              </select>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div className="tabs">
              {(["claude", "codex", "codebuddy"] as const).map((tool) => (
                <button key={tool} type="button" className={`tab ${tab === tool ? "active" : ""}`} onClick={() => setTab(tool)}>
                  {tool}
                </button>
              ))}
            </div>
          </div>
          <div className="card-body">
            {tab === "claude" && (
              <>
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
          </div>
        </div>
      </div>
    </section>
  );
}
