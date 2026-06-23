import { useState, type ReactNode } from "react";
import { PLATFORM_FIELD_LABEL, PLATFORM_HELP_KEY, PLATFORM_SUMMARY_KEY, INLINE_TIP_KEY } from "../fieldLabels.js";
import type { AiCommand, PlatformKey, WebConfigPayload } from "../types.js";
import { PLATFORM_EMOJI } from "../platform-emoji.js";
import { AiCommandPicker } from "./AiCommandPicker.js";
import { QrBindModal } from "./QrBindModal.js";
import type { JsonRequest } from "../api.js";

interface PlatformDef {
  key: string;
  label: string;
  fields: readonly string[];
  testFields: readonly string[];
  requiredFields: readonly string[];
  sensitiveFields: readonly string[];
  qrLogin?: boolean;
  bindField?: string;
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
  request?: JsonRequest;
}

export function PlatformCard({ def, values, t, html, disabledVisual, onChange, onTest, testing, testResult, request }: Props) {
  const sk = PLATFORM_SUMMARY_KEY[def.key as keyof typeof PLATFORM_SUMMARY_KEY];
  const hk = PLATFORM_HELP_KEY[def.key as keyof typeof PLATFORM_HELP_KEY];
  const enabled = (values as { enabled?: boolean }).enabled ?? false;
  const [expanded, setExpanded] = useState(enabled);
  const [qrOpen, setQrOpen] = useState(false);

  /* ── 扫码绑定平台：单按钮卡片，不暴露任何凭据字段 ── */
  if (def.qrLogin && def.bindField) {
    const bound = String((values as Record<string, unknown>)[def.bindField] ?? "").trim() !== "";
    return (
      <div className={`platform-card ${bound ? "enabled" : ""}`}>
        <div className="platform-card-head">
          <div className="platform-card-meta">
            <div className="platform-card-icon">{PLATFORM_EMOJI[def.key as PlatformKey]}</div>
            <div className="platform-card-title-block">
              <div className="platform-card-name">{def.label}</div>
              {sk && <div className="platform-card-desc">{t(sk)}</div>}
            </div>
          </div>
          <div className="platform-card-right">
            <span className={`platform-status-badge ${bound ? "on" : "off"}`}>
              {bound ? t("platformBound") : t("platformUnbound")}
            </span>
            {!bound && (
              <button
                type="button"
                className="btn btn-p btn-sm"
                onClick={() => setQrOpen(true)}
              >
                {t("configure")}
              </button>
            )}
            {bound && (
              <>
                <button
                  type="button"
                  className="btn btn-s btn-sm"
                  onClick={() => setQrOpen(true)}
                >
                  编辑配置
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    if (!window.confirm("确定移除该平台的绑定配置吗？")) return;
                    const patch: Record<string, unknown> = { [def.bindField as string]: "", enabled: false };
                    onChange(patch);
                  }}
                >
                  移除配置
                </button>
              </>
            )}
          </div>
        </div>
        {request && (
          <QrBindModal
            open={qrOpen}
            onClose={() => setQrOpen(false)}
            onSuccess={(r) => {
              const patch: Record<string, unknown> = { [def.bindField as string]: r.botToken, enabled: true };
              if (r.baseUrl) patch.apiUrl = r.baseUrl;
              onChange(patch);
            }}
            request={request}
            t={t}
          />
        )}
      </div>
    );
  }

  /* ── 普通平台：保持原字段表单 ── */
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
        ) : f === "aiCommand" ? null : (
          <input className="form-input mono" type={isPwd ? "password" : "text"} value={String((values as Record<string, string>)[f] ?? "")} onChange={(e) => onChange({ [f]: e.target.value })} />
        )}
        {tipK && <div className="field-tip" dangerouslySetInnerHTML={{ __html: html(tipK) }} />}
      </div>
    );
  };

  return (
    <div className={`platform-card ${disabledVisual ? "disabled" : ""} ${enabled ? "enabled" : ""} ${expanded ? "expanded" : ""}`}>
      <div className="platform-card-head" onClick={() => setExpanded(!expanded)}>
        <div className="platform-card-meta">
          <div className="platform-card-icon">{PLATFORM_EMOJI[def.key as PlatformKey]}</div>
          <div className="platform-card-title-block">
            <div className="platform-card-name">{def.label}</div>
            {sk && <div className="platform-card-desc">{t(sk)}</div>}
          </div>
        </div>
        <div className="platform-card-right">
          <span className={`platform-status-badge ${enabled ? "on" : "off"}`}>
            {enabled ? t("platformStatusOn") : t("platformStatusOff")}
          </span>
          <span className="platform-card-chevron">{expanded ? "▾" : "▸"}</span>
          <label className="toggle" onClick={(e) => e.stopPropagation()}>
            <input type="checkbox" className="toggle-input sr-only" checked={enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
            <span className="toggle-track" />
          </label>
        </div>
      </div>
      {expanded && (<div className="platform-card-body">
        {sk && <p className="platform-card-hint">{t(sk)}</p>}

        <AiCommandPicker
          value={String((values as Record<string, string>).aiCommand || "claude") as AiCommand}
          onChange={(v) => onChange({ aiCommand: v })}
          t={t as (k: string) => string}
        />
        <hr className="platform-card-divider" />

        {def.fields.map(field)}

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
      </div>)}
    </div>
  );
}
