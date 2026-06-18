import { useState, type ReactNode } from "react";
import { PLATFORM_FIELD_LABEL, PLATFORM_HELP_KEY, PLATFORM_SUMMARY_KEY, INLINE_TIP_KEY } from "../fieldLabels.js";
import type { AiCommand, WebConfigPayload } from "../types.js";

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

export function PlatformCard({ def, values, t, html, disabledVisual, onChange, onTest, testing, testResult, qrState, qrCodeUrl, qrMessage, onQrLogin }: Props) {
  const sk = PLATFORM_SUMMARY_KEY[def.key as keyof typeof PLATFORM_SUMMARY_KEY];
  const hk = PLATFORM_HELP_KEY[def.key as keyof typeof PLATFORM_HELP_KEY];
  const enabled = (values as { enabled?: boolean }).enabled ?? false;
  const [expanded, setExpanded] = useState(enabled);

  const field = (f: string): ReactNode => {
    const labels = PLATFORM_FIELD_LABEL[def.key as keyof typeof PLATFORM_FIELD_LABEL];
    const lk = labels ? (labels as Record<string, string | undefined>)[f] : undefined;
    const tipK = (INLINE_TIP_KEY as Record<string, string | undefined>)[`${def.key}-${f}`];
    const isPwd = def.sensitiveFields.includes(f);

    return (
      <div className="form-group" key={f}>
        <label className="form-label">{lk ? t(lk) : f}</label>
        {f === "allowedUserIds" ? (
          <>
            <textarea className="form-textarea mono" value={String((values as Record<string, string>)[f] ?? "")} onChange={(e) => onChange({ [f]: e.target.value })} />
            <div className="form-hint">{t("commaSeparatedIds")}</div>
          </>
        ) : f === "aiCommand" ? (
          <select className="form-select" value={String((values as Record<string, string>)[f] || "claude")} onChange={(e) => onChange({ aiCommand: e.target.value as AiCommand })}>
            <option value="claude">claude</option>
            <option value="codex">codex</option>
            <option value="codebuddy">codebuddy</option>
            <option value="opencode">opencode</option>
          </select>
        ) : (
          <input className="form-input mono" type={isPwd ? "password" : "text"} value={String((values as Record<string, string>)[f] ?? "")} onChange={(e) => onChange({ [f]: e.target.value })} />
        )}
        {tipK && <div className="field-tip" dangerouslySetInnerHTML={{ __html: html(tipK) }} />}
      </div>
    );
  };

  return (
    <div className={`platform-card ${disabledVisual ? "disabled" : ""} ${enabled ? "enabled" : ""} ${expanded ? "expanded" : ""}`}>
      <div className="platform-card-head" style={{ cursor: "pointer" }} onClick={() => setExpanded(!expanded)}>
        <span className="platform-card-name">
          <span className="dot" />
          {def.label}
          <span className="platform-card-chevron">{expanded ? "▾" : "▸"}</span>
        </span>
        <label className="toggle" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" className="toggle-input sr-only" checked={enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
          <span className="toggle-track" />
        </label>
      </div>
      {expanded && (<div className="platform-card-body">
        {sk && <p className="platform-card-hint">{t(sk)}</p>}
        {def.fields.map(field)}

        {/* ClawBot TTS 配置 */}
        {def.key === 'clawbot' && (
          <div style={{ marginTop: 16, padding: 12, background: 'var(--c-surface-alt)', borderRadius: 'var(--r-m)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-text)', marginBottom: 8 }}>🔊 语音回复</div>
            <label className="toggle" style={{ marginBottom: 12 }}>
              <input type="checkbox" className="toggle-input sr-only" checked={(values as Record<string, unknown>).ttsEnabled as boolean || false} onChange={(e) => onChange({ ttsEnabled: e.target.checked })} />
              <span className="toggle-track" />
              <span style={{ fontSize: 13 }}>启用语音回复</span>
            </label>
            {(values as Record<string, unknown>).ttsEnabled && (
              <div className="form-group">
                <label className="form-label">语音</label>
                <select className="form-select" value={(values as Record<string, unknown>).ttsVoice as string || 'zh-CN-XiaoxiaoNeural'} onChange={(e) => onChange({ ttsVoice: e.target.value })}>
                  <option value="zh-CN-XiaoxiaoNeural">晓晓（女声，温柔）</option>
                  <option value="zh-CN-XiaoyiNeural">晓伊（女声，活泼）</option>
                  <option value="zh-CN-YunxiNeural">云希（男声，年轻）</option>
                  <option value="zh-CN-YunjianNeural">云健（男声，沉稳）</option>
                  <option value="zh-CN-YunyangNeural">云扬（男声，专业）</option>
                </select>
              </div>
            )}
          </div>
        )}

        {hk && <div className="platform-card-help" dangerouslySetInnerHTML={{ __html: html(hk) }} />}
        {(def as Record<string, unknown>).docUrl && (
          <div style={{ marginTop: 12 }}>
            <a href={(def as Record<string, string>).docUrl} target="_blank" rel="noreferrer" className="btn btn-g btn-sm" style={{ textDecoration: "none" }}>
              📖 {(def as Record<string, string>).docLabel || "接入指南"}
            </a>
          </div>
        )}
        <div className="platform-card-actions">
          <button type="button" className="btn btn-s btn-sm" disabled={testing} onClick={onTest}>
            {testing ? t("testing") : t("test")}
          </button>
        </div>
        {testResult?.text && <div className={`msg mt-4 ${testResult.ok ? "msg-ok" : "msg-err"}`}>{testResult.text}</div>}
        {onQrLogin && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" className="btn btn-p btn-sm" disabled={qrState === "loading" || qrState === "scanning"} onClick={onQrLogin}>
                {qrState === "loading" ? "..." : qrState === "scanning" ? t("qrLoginScanning") : t("qrLoginBtn")}
              </button>
              {qrState === "scanning" && <span className="form-hint">{t("qrScanHint")}</span>}
            </div>
            {qrCodeUrl && qrState === "scanning" && (
              <div style={{ marginTop: 12, textAlign: "center" }}>
                <img src={qrCodeUrl.startsWith("data:") ? qrCodeUrl : `data:image/png;base64,${qrCodeUrl}`} alt="QR" style={{ width: 180, height: 180, border: "1px solid var(--c-border)", borderRadius: 8 }} />
              </div>
            )}
            {qrMessage && <div className={`msg mt-4 ${qrState === "success" ? "msg-ok" : "msg-err"}`}>{qrMessage}</div>}
          </div>
        )}
      </div>)}
    </div>
  );
}
