import { useState } from "react";

interface Props {
  configJson: string;
  setConfigJson: (v: string) => void;
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
  hideHeading?: boolean;
}

function toMsg(e: unknown): string { return e instanceof Error ? e.message : String(e); }

function JsonCard({ title, hint, json, setJson, onSave, formatBtn, resetBtn, onFormat, onReset, validation, setMessage, t }: {
  title: string; hint: string; json: string; setJson: (v: string) => void;
  onSave: () => Promise<void>; formatBtn?: boolean; resetBtn?: boolean;
  onFormat?: () => void; onReset?: () => void;
  validation?: { text: string; type: "success" | "error" } | null;
  setMessage: (m: { text: string; type: "success" | "error" | "" }) => void;
  t: (k: string) => string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card config-card">
      <div className="card-head" style={{ cursor: "pointer" }} onClick={() => setOpen(!open)}>
        <span className="card-title">{title}</span>
        <span style={{ fontSize: 12, color: "var(--c-text-3)" }}>{open ? "▾" : "▸"}</span>
      </div>
      {open && (
        <div className="card-body">
          <p className="form-hint">{hint}</p>
          {(formatBtn || resetBtn) && (
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginBottom: 8 }}>
              {formatBtn && <button type="button" className="btn btn-g btn-sm" onClick={onFormat}>{t("formatJson")}</button>}
              {resetBtn && <button type="button" className="btn btn-g btn-sm" onClick={onReset}>{t("resetJson")}</button>}
            </div>
          )}
          <textarea className="form-input mono" rows={14} spellCheck={false} value={json} onChange={(e) => setJson(e.target.value)} style={{ minHeight: 200, resize: "vertical", whiteSpace: "pre" }} />
          {validation && <div className={`msg mt-4 ${validation.type === "success" ? "msg-ok" : "msg-err"}`}>{validation.text}</div>}
          <div style={{ marginTop: 10 }}>
            <button type="button" className="btn btn-s btn-sm" onClick={() => void (async () => { try { await onSave(); setMessage({ text: t("saveOk"), type: "success" }); } catch (e) { setMessage({ text: toMsg(e), type: "error" }); } })()}>
              {t("saveBtn")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ConfigFilesSection({
  configJson, setConfigJson,
  claudeSettingsJson, setClaudeSettingsJson,
  codexSettingsJson, setCodexSettingsJson,
  jsonValidation,
  onSaveConfig, onSaveClaude, onSaveCodex,
  onFormat, onReset,
  meta, setMessage, t, forwardRef, hideHeading = false,
}: Props) {
  return (
    <section className="section" ref={forwardRef as React.RefObject<HTMLElement>}>
      {!hideHeading && (
        <div className="section-head">
          <div>
            <h2 className="section-title">{t("configFilesTitle")}</h2>
            <p className="section-desc">{t("configFilesHint")}</p>
          </div>
        </div>
      )}
      <div className="config-stack">
        <JsonCard title={t("configJson")} hint={t("openImConfigCardHint")} json={configJson} setJson={setConfigJson} onSave={onSaveConfig} formatBtn resetBtn onFormat={onFormat} onReset={onReset} validation={jsonValidation} setMessage={setMessage} t={t} />
        <JsonCard title={t("claudeSettingsLabel")} hint={t("claudeSettingsCardHint")} json={claudeSettingsJson} setJson={setClaudeSettingsJson} onSave={onSaveClaude} setMessage={setMessage} t={t} />
        <JsonCard title={t("codexSettingsLabel")} hint={t("codexSettingsCardHint")} json={codexSettingsJson} setJson={setCodexSettingsJson} onSave={onSaveCodex} setMessage={setMessage} t={t} />
      </div>
      {meta.configPath && <p className="form-hint" style={{ marginTop: 16 }}>{t("configJson")}: {meta.configPath}</p>}
    </section>
  );
}
