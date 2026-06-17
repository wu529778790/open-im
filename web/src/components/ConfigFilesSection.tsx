interface Props {
  configJson: string;
  setConfigJson: (v: string) => void;
  originalConfigJson: string;
  claudeSettingsJson: string;
  setClaudeSettingsJson: (v: string) => void;
  codexSettingsJson: string;
  setCodexSettingsJson: (v: string) => void;
  jsonValidation: { text: string; type: "success" | "error" } | null;
  onSaveConfig: () => Promise<void>;
  onSaveClaude: () => Promise<void>;
  onSaveCodex: () => Promise<void>;
  onFormat: () => void;
  onReset: () => void;
  meta: { configPath: string };
  setMessage: (m: { text: string; type: "success" | "error" | "" }) => void;
  t: (k: string) => string;
  forwardRef?: React.RefObject<HTMLElement | null>;
}

export function ConfigFilesSection({
  configJson,
  setConfigJson,
  claudeSettingsJson,
  setClaudeSettingsJson,
  codexSettingsJson,
  setCodexSettingsJson,
  jsonValidation,
  onSaveConfig,
  onSaveClaude,
  onSaveCodex,
  onFormat,
  onReset,
  meta,
  setMessage,
  t,
  forwardRef,
}: Props) {
  const toErrorMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

  return (
    <section className="section" ref={forwardRef as React.RefObject<HTMLElement>}>
      <div className="section-header">
        <h2 className="section-title">{t("configFilesTitle")}</h2>
        <p className="section-description">{t("configFilesHint")}</p>
      </div>
      <div className="config-files-stack">
        <div className="card config-file-card">
          <div className="card-header">
            <h3 className="card-title mono">{t("configJson")}</h3>
          </div>
          <div className="card-body">
            <p className="form-hint">{t("openImConfigCardHint")}</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 8 }}>
              <button type="button" className="btn btn-sm btn-ghost" onClick={onFormat}>
                {t("formatJson")}
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={onReset}>
                {t("resetJson")}
              </button>
            </div>
            <textarea
              className="form-input mono"
              rows={18}
              spellCheck={false}
              value={configJson}
              onChange={(e) => setConfigJson(e.target.value)}
              style={{ minHeight: 360, resize: "vertical", whiteSpace: "pre" }}
            />
            {jsonValidation ? (
              <div className={`message mt-4 ${jsonValidation.type === "success" ? "message-success" : "message-error"}`}>{jsonValidation.text}</div>
            ) : null}
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() =>
                  void (async () => {
                    try {
                      await onSaveConfig();
                      setMessage({ text: t("saveOk"), type: "success" });
                    } catch (e) {
                      setMessage({ text: toErrorMsg(e), type: "error" });
                    }
                  })()
                }
              >
                {t("saveBtn")}
              </button>
            </div>
          </div>
        </div>
        <div className="card config-file-card">
          <div className="card-header">
            <h3 className="card-title mono">{t("claudeSettingsLabel")}</h3>
          </div>
          <div className="card-body">
            <p className="form-hint">{t("claudeSettingsCardHint")}</p>
            <textarea
              className="form-input mono"
              rows={12}
              spellCheck={false}
              value={claudeSettingsJson}
              onChange={(e) => setClaudeSettingsJson(e.target.value)}
              style={{ minHeight: 220, resize: "vertical", whiteSpace: "pre" }}
            />
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() =>
                  void (async () => {
                    try {
                      await onSaveClaude();
                      setMessage({ text: t("saveOk"), type: "success" });
                    } catch (e) {
                      setMessage({ text: toErrorMsg(e), type: "error" });
                    }
                  })()
                }
              >
                {t("saveBtn")}
              </button>
            </div>
          </div>
        </div>
        <div className="card config-file-card">
          <div className="card-header">
            <h3 className="card-title mono">{t("codexSettingsLabel")}</h3>
          </div>
          <div className="card-body">
            <p className="form-hint">{t("codexSettingsCardHint")}</p>
            <textarea
              className="form-input mono"
              rows={8}
              spellCheck={false}
              value={codexSettingsJson}
              onChange={(e) => setCodexSettingsJson(e.target.value)}
              style={{ minHeight: 160, resize: "vertical", whiteSpace: "pre" }}
            />
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() =>
                  void (async () => {
                    try {
                      await onSaveCodex();
                      setMessage({ text: t("saveOk"), type: "success" });
                    } catch (e) {
                      setMessage({ text: toErrorMsg(e), type: "error" });
                    }
                  })()
                }
              >
                {t("saveBtn")}
              </button>
            </div>
          </div>
        </div>
      </div>
      <p className="form-hint" style={{ marginTop: 24 }}>
        {meta.configPath ? `${t("configJson")}: ${meta.configPath}` : ""}
      </p>
    </section>
  );
}
