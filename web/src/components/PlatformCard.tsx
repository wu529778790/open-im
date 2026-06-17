import type { ReactNode } from "react";
import { PLATFORM_FIELD_LABEL, PLATFORM_HELP_KEY, PLATFORM_SUMMARY_KEY } from "../fieldLabels.js";
import { INLINE_TIP_KEY } from "../fieldLabels.js";
import type { AiCommand, WebConfigPayload } from "../types.js";

/** Narrowed shape of a PLATFORM_DEFINITIONS entry */
interface PlatformDef {
  key: string;
  label: string;
  fields: readonly string[];
  testFields: readonly string[];
  requiredFields: readonly string[];
  sensitiveFields: readonly string[];
}

interface Props {
  def: PlatformDef;
  values: WebConfigPayload["platforms"][keyof WebConfigPayload["platforms"]];
  t: (k: string, p?: Record<string, string | number>) => string;
  html: (k: string) => string;
  disabledVisual: boolean;
  onChange: (patch: Record<string, unknown>) => void;
  onTest: () => void;
  testing: boolean;
  testResult?: { text: string; ok: boolean };
  qrState?: "idle" | "loading" | "scanning" | "success" | "error";
  qrCodeUrl?: string;
  qrMessage?: string;
  onQrLogin?: () => void;
}

export function PlatformCard({
  def,
  values,
  t,
  html,
  disabledVisual,
  onChange,
  onTest,
  testing,
  testResult,
  qrState,
  qrCodeUrl,
  qrMessage,
  onQrLogin,
}: Props) {
  const summaryKey = PLATFORM_SUMMARY_KEY[def.key as keyof typeof PLATFORM_SUMMARY_KEY];
  const helpKey = PLATFORM_HELP_KEY[def.key as keyof typeof PLATFORM_HELP_KEY];

  const fieldInput = (field: string): ReactNode => {
    const fieldLabels = PLATFORM_FIELD_LABEL[def.key as keyof typeof PLATFORM_FIELD_LABEL];
    const labelKey = fieldLabels ? (fieldLabels as Record<string, string | undefined>)[field] : undefined;
    const tipId = `${def.key}-${field}`;
    const tipKey = (INLINE_TIP_KEY as Record<string, string | undefined>)[tipId];
    const isArea = field === "allowedUserIds";
    const isPassword = def.sensitiveFields.includes(field);

    return (
      <div className="form-group" key={field}>
        <label className="form-label">{labelKey ? t(labelKey) : field}</label>
        {isArea ? (
          <textarea
            className="form-textarea mono"
            value={String((values as Record<string, string>)[field] ?? "")}
            onChange={(e) => onChange({ [field]: e.target.value })}
          />
        ) : field === "aiCommand" ? (
          <select
            className="form-select"
            value={String((values as Record<string, string>)[field] || "claude")}
            onChange={(e) => onChange({ aiCommand: e.target.value as AiCommand })}
          >
            <option value="claude">claude</option>
            <option value="codex">codex</option>
            <option value="codebuddy">codebuddy</option>
          </select>
        ) : (
          <input
            className="form-input mono"
            type={isPassword ? "password" : "text"}
            value={String((values as Record<string, string>)[field] ?? "")}
            onChange={(e) => onChange({ [field]: e.target.value })}
          />
        )}
        {field === "allowedUserIds" ? <div className="form-hint">{t("commaSeparatedIds")}</div> : null}
        {tipKey ? (
          <div className="field-inline-tip" dangerouslySetInnerHTML={{ __html: html(tipKey) }} />
        ) : null}
      </div>
    );
  };

  return (
    <div className={`platform-card ${disabledVisual ? "disabled" : ""}`}>
      <div className="platform-header">
        <h3 className="platform-title">{def.label}</h3>
        <label className="toggle">
          <input
            type="checkbox"
            className="toggle-input"
            checked={(values as { enabled?: boolean }).enabled ?? false}
            onChange={(e) => onChange({ enabled: e.target.checked })}
          />
          <span className="toggle-switch" />
          <span className="toggle-label">{t("enabled")}</span>
        </label>
      </div>
      <div className="platform-body">
        <p className="form-hint">{summaryKey ? t(summaryKey) : ""}</p>
        {def.fields.map((f) => fieldInput(f))}
        {helpKey ? (
          <div className="form-help" dangerouslySetInnerHTML={{ __html: html(helpKey) }} />
        ) : null}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-secondary btn-sm" disabled={testing} onClick={onTest}>
            {testing ? t("testing") : t("test")}
          </button>
        </div>
        {testResult?.text ? (
          <div className={`message mt-4 ${testResult.ok ? "message-success" : "message-error"}`}>{testResult.text}</div>
        ) : null}
        {onQrLogin ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={qrState === "loading" || qrState === "scanning"}
                onClick={onQrLogin}
              >
                {qrState === "loading" ? "..." : qrState === "scanning" ? t("qrLoginScanning") : t("qrLoginBtn")}
              </button>
              {qrState === "scanning" ? <span className="form-hint">{t("qrScanHint")}</span> : null}
            </div>
            {qrCodeUrl && qrState === "scanning" ? (
              <div style={{ marginTop: 12, textAlign: "center" }}>
                <img
                  src={qrCodeUrl.startsWith("data:") ? qrCodeUrl : `data:image/png;base64,${qrCodeUrl}`}
                  alt="QR Code"
                  style={{ width: 200, height: 200, border: "1px solid var(--border)", borderRadius: 8 }}
                />
              </div>
            ) : null}
            {qrMessage ? (
              <div className={`message mt-4 ${qrState === "success" ? "message-success" : qrState === "error" ? "message-error" : ""}`}>
                {qrMessage}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
