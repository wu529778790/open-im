import { useState } from "react";
import type { WebConfigPayload } from "../types.js";

interface Props {
  ai: WebConfigPayload["ai"];
  onUpdate: (patch: Partial<WebConfigPayload["ai"]>) => void;
  t: (k: string) => string;
  html: (k: string) => string;
  forwardRef?: React.RefObject<HTMLElement | null>;
}

export function AiConfigSection({ ai, onUpdate, t, html, forwardRef }: Props) {
  const [currentTab, setCurrentTab] = useState<"claude" | "codex" | "codebuddy">("claude");

  return (
    <section className="section" ref={forwardRef as React.RefObject<HTMLElement>}>
      <div className="section-header">
        <h2 className="section-title">{t("aiTitle")}</h2>
        <p className="section-description">{t("aiHint")}</p>
      </div>
      <div className="ai-grid">
        <div className="ai-card">
          <div className="card-header">
            <h3 className="card-title">{t("aiCommonTitle")}</h3>
          </div>
          <div className="ai-card-body">
            <p className="form-hint" style={{ marginBottom: 12 }}>
              {t("aiPerPlatformHint")}
            </p>
            <div className="form-group">
              <label className="form-label">{t("workDir")}</label>
              <input
                className="form-input mono"
                value={ai.claudeWorkDir}
                onChange={(e) => onUpdate({ claudeWorkDir: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">{t("hookPort")}</label>
              <input
                type="number"
                min={1}
                className="form-input"
                value={ai.hookPort || ""}
                onChange={(e) => onUpdate({ hookPort: Number(e.target.value) || 0 })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">{t("logLevel")}</label>
              <select
                className="form-select"
                value={ai.logLevel}
                onChange={(e) => onUpdate({ logLevel: e.target.value })}
              >
                <option value="default">{t("logLevelDefault")}</option>
                <option value="DEBUG">DEBUG</option>
                <option value="INFO">INFO</option>
                <option value="WARN">WARN</option>
                <option value="ERROR">ERROR</option>
              </select>
            </div>
          </div>
        </div>

        <div className="ai-card">
          <div className="card-header">
            <div className="tabs">
              {(["claude", "codex", "codebuddy"] as const).map((tool) => (
                <button
                  key={tool}
                  type="button"
                  className={`tab ${currentTab === tool ? "active" : ""}`}
                  onClick={() => setCurrentTab(tool)}
                >
                  {tool}
                </button>
              ))}
            </div>
          </div>
          <div className="ai-card-body">
            <div className={`ai-tool-panel ${currentTab === "claude" ? "active" : ""}`}>
              <div className="form-group">
                <label className="form-label">{t("claudeProxy")}</label>
                <input
                  className="form-input mono"
                  value={ai.claudeProxy}
                  onChange={(e) => onUpdate({ claudeProxy: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">{t("claudeConfigPath")}</label>
                <input className="form-input mono" readOnly style={{ background: "var(--bg-secondary)" }} value={ai.claudeConfigPath} />
              </div>
            </div>
            <div className={`ai-tool-panel ${currentTab === "codex" ? "active" : ""}`}>
              <div className="form-group">
                <label className="form-label">{t("codexApiKey")}</label>
                <input
                  className="form-input mono"
                  type="password"
                  value={ai.codexApiKey ?? ""}
                  onChange={(e) => onUpdate({ codexApiKey: e.target.value })}
                />
                <p className="field-inline-tip" dangerouslySetInnerHTML={{ __html: t("codexApiKeyTip") }} />
              </div>
              <div className="form-group">
                <label className="form-label">{t("codexCli")}</label>
                <input
                  className="form-input mono"
                  value={ai.codexCliPath}
                  onChange={(e) => onUpdate({ codexCliPath: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">{t("codexProxy")}</label>
                <input
                  className="form-input mono"
                  value={ai.codexProxy}
                  onChange={(e) => onUpdate({ codexProxy: e.target.value })}
                />
              </div>
            </div>
            <div className={`ai-tool-panel ${currentTab === "codebuddy" ? "active" : ""}`}>
              <div className="form-group">
                <label className="form-label">{t("codebuddyCli")}</label>
                <input
                  className="form-input mono"
                  value={ai.codebuddyCliPath}
                  onChange={(e) => onUpdate({ codebuddyCliPath: e.target.value })}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
