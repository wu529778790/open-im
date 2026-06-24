import { useEffect, useRef, useState, type ReactNode } from "react";
import { PLATFORM_FIELD_LABEL, PLATFORM_HELP_HTML, PLATFORM_SUMMARY, INLINE_TIP_HTML } from "../fieldLabels.js";
import type { AiCommand, PlatformKey, WebConfigPayload } from "../types.js";
import { PLATFORM_EMOJI } from "../platform-emoji.js";
import { AI_TOOL_DEFINITIONS } from "../tool-definitions.js";
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
  disabledVisual: boolean;
  onChange: (patch: Record<string, unknown>) => void;
  onTest: () => void;
  testing: boolean;
  testResult?: { text: string; ok: boolean };
  request?: JsonRequest;
  /** 绑定/移除/AI切换后立即持久化到磁盘（Dashboard 用，SetupWizard 不传则最后统一保存） */
  onPersist?: (patch: Record<string, unknown>) => void;
}

export function PlatformCard({ def, values, disabledVisual, onChange, onTest, testing, testResult, request, onPersist }: Props) {
  const sk = PLATFORM_SUMMARY[def.key as keyof typeof PLATFORM_SUMMARY];
  const hk = PLATFORM_HELP_HTML[def.key as keyof typeof PLATFORM_HELP_HTML];
  const enabled = (values as { enabled?: boolean }).enabled ?? false;
  const [expanded, setExpanded] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const aiRef = useRef<HTMLDivElement | null>(null);

  const isQr = !!def.qrLogin && !!def.bindField;
  const bound = isQr
    ? String((values as Record<string, unknown>)[def.bindField as string] ?? "").trim() !== ""
    : enabled;
  const aiCommand = String((values as Record<string, unknown>).aiCommand || "claude") as AiCommand;
  const aiLabel = AI_TOOL_DEFINITIONS.find((tool) => tool.key === aiCommand)?.label ?? "Claude";

  /* 点击外部关闭三点菜单 / AI 下拉 */
  useEffect(() => {
    if (!menuOpen && !aiOpen) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuOpen && menuRef.current && !menuRef.current.contains(target)) setMenuOpen(false);
      if (aiOpen && aiRef.current && !aiRef.current.contains(target)) setAiOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen, aiOpen]);

  /* ── 编辑配置 ── */
  const onEdit = () => {
    setMenuOpen(false);
    if (isQr) {
      setQrOpen(true);
    } else {
      setExpanded((v) => !v);
    }
  };

  /* ── 移除配置 ── */
  const onRemove = () => {
    setMenuOpen(false);
    if (!window.confirm(`确定移除 ${def.label} 的配置吗？`)) return;
    const patch: Record<string, unknown> = { enabled: false };
    if (isQr && def.bindField) {
      patch[def.bindField] = "";
    } else {
      def.sensitiveFields.forEach((f) => { patch[f] = ""; });
    }
    onChange(patch);
    onPersist?.(patch);
    setExpanded(false);
  };

  /* ── 切换 AI 工具 ── */
  const onPickAi = (key: AiCommand) => {
    setAiOpen(false);
    const patch: Record<string, unknown> = { aiCommand: key };
    onChange(patch);
    onPersist?.(patch);
  };

  /* ── 字段渲染（字段平台用） ── */
  const field = (f: string): ReactNode => {
    const labels = PLATFORM_FIELD_LABEL[def.key as keyof typeof PLATFORM_FIELD_LABEL];
    const lk = labels ? (labels as Record<string, string | undefined>)[f] : undefined;
    const tipK = (INLINE_TIP_HTML as Record<string, string | undefined>)[`${def.key}-${f}`];
    const isPwd = def.sensitiveFields.includes(f);
    return (
      <div className="form-group" key={f}>
        <label className="form-label">{lk ?? f}</label>
        {f === "allowedUserIds" ? (
          <>
            <textarea className="form-textarea mono" value={String((values as Record<string, string>)[f] ?? "")} onChange={(e) => onChange({ [f]: e.target.value })} />
            <div className="form-hint">多个 ID 用逗号分隔</div>
          </>
        ) : f === "aiCommand" ? null : (
          <input className="form-input mono" type={isPwd ? "password" : "text"} value={String((values as Record<string, string>)[f] ?? "")} onChange={(e) => onChange({ [f]: e.target.value })} />
        )}
        {tipK && <div className="field-tip" dangerouslySetInnerHTML={{ __html: tipK }} />}
      </div>
    );
  };

  const hasConfig = isQr ? bound : def.sensitiveFields.some((f) => String((values as Record<string, string>)[f] ?? "").trim() !== "");

  return (
    <div className={`platform-card ${disabledVisual ? "disabled" : ""} ${enabled ? "enabled" : ""} ${expanded ? "expanded" : ""}`}>
      <div className="platform-card-head">
        <div className="platform-card-meta">
          <div className="platform-card-icon">{PLATFORM_EMOJI[def.key as PlatformKey]}</div>
          <div className="platform-card-title-block">
            <div className="platform-card-name">{def.label}</div>
            {sk && <div className="platform-card-desc">{sk}</div>}
          </div>
        </div>
        <div className="platform-card-right">
          {/* AI 标签 */}
          <div className="platform-card-control platform-card-control-ai">
            <div className="platform-card-menu" ref={aiRef}>
              <button
                type="button"
                className="platform-card-ai-tag"
                onClick={() => setAiOpen((v) => !v)}
                title="选择 AI 工具"
              >
                {aiLabel} ▾
              </button>
              {aiOpen && (
                <div className="platform-card-ai-dropdown">
                  {AI_TOOL_DEFINITIONS.map((tool) => (
                    <button
                      key={tool.key}
                      type="button"
                      className={`platform-card-ai-option ${tool.key === aiCommand ? "active" : ""}`}
                      onClick={() => onPickAi(tool.key as AiCommand)}
                    >
                      {tool.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 状态徽章 */}
          <div className="platform-card-control platform-card-control-status">
            <span className={`platform-status-badge ${bound ? "on" : "off"}`}>
              {isQr
                ? (bound ? "已绑定" : "未绑定")
                : (enabled ? "已连接" : "未连接")}
            </span>
          </div>

          {/* 三点菜单 */}
          <div className="platform-card-control platform-card-control-menu">
            <div className="platform-card-menu" ref={menuRef}>
              <button
                type="button"
                className="platform-card-menu-btn"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="更多操作"
              >
                ⋯
              </button>
              {menuOpen && (
                <div className="platform-card-menu-dropdown">
                  <button type="button" className="platform-card-menu-item" onClick={onEdit}>
                    编辑配置
                  </button>
                  <button
                    type="button"
                    className="platform-card-menu-item danger"
                    onClick={onRemove}
                    disabled={!hasConfig}
                  >
                    移除配置
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 已配置：显示开关；未配置：显示「配置」按钮 */}
          <div className="platform-card-control platform-card-control-action">
            {hasConfig ? (
              <label className="toggle" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" className="toggle-input sr-only" checked={enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
                <span className="toggle-track" />
              </label>
            ) : (
              <button
                type="button"
                className="btn btn-p btn-sm platform-card-config-btn"
                onClick={onEdit}
              >
                配置
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 字段平台：展开的字段表单 */}
      {!isQr && expanded && (
        <div className="platform-card-body">
          {sk && <p className="platform-card-hint">{sk}</p>}
          {def.fields.map(field)}
          {hk && <div className="platform-card-help" dangerouslySetInnerHTML={{ __html: hk }} />}
          {(def as Record<string, unknown>).docUrl && (
            <div style={{ marginTop: 12 }}>
              <a href={(def as Record<string, string>).docUrl} target="_blank" rel="noreferrer" className="btn btn-g btn-sm" style={{ textDecoration: "none" }}>
                📖 {(def as Record<string, string>).docLabel || "接入指南"}
              </a>
            </div>
          )}
          <div className="platform-card-actions">
            <button type="button" className="btn btn-s btn-sm" disabled={testing} onClick={onTest}>
              {testing ? "校验中..." : "校验配置"}
            </button>
          </div>
          {testResult?.text && <div className={`msg mt-4 ${testResult.ok ? "msg-ok" : "msg-err"}`}>{testResult.text}</div>}
        </div>
      )}

      {/* 扫码平台：二维码模态框 */}
      {isQr && request && (
        <QrBindModal
          open={qrOpen}
          onClose={() => setQrOpen(false)}
          platform={def.key}
          onSuccess={(r) => {
            const patch: Record<string, unknown> = { enabled: true };
            if (def.key === "clawbot") {
              if (r.botToken) patch.apiToken = r.botToken;
              if (r.baseUrl) patch.apiUrl = r.baseUrl;
            } else if (def.key === "workbuddy") {
              if (r.accessToken) patch.accessToken = r.accessToken;
              if (r.refreshToken) patch.refreshToken = r.refreshToken;
              if (r.userId) patch.userId = r.userId;
            }
            onChange(patch);
            onPersist?.(patch);
          }}
          request={request}
        />
      )}
    </div>
  );
}