import { useState, useCallback, useEffect } from "react";
import { PLATFORM_KEYS, PLATFORM_DEFINITIONS } from "../constants.js";
import type { PlatformKey, WebConfigPayload } from "../types.js";
import { PlatformSection } from "./PlatformSection.js";
import { emptyPayload } from "../empty-payload.js";

/* ─── helpers ─── */
function toMsg(e: unknown): string { return e instanceof Error ? e.message : String(e); }

/* ─── types ─── */
type T    = (k: string, p?: Record<string, string | number>) => string;
type Html = (k: string) => string;
type Req  = (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;

/* 向导步骤 */
type WizardStep = "platforms" | "ai-config" | "complete";

interface Props {
  request: Req;
  t: T;
  html: Html;
  onComplete: () => void;
  initialPayload?: WebConfigPayload;
}

/* ═══════════════════════════════════════════════════════ */
export function SetupWizard({ request, onComplete, initialPayload }: Props) {
  const [payload, setPl] = useState<WebConfigPayload>(initialPayload ?? emptyPayload());
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState("");
  
  /* 当前步骤 */
  const [step, setStep] = useState<WizardStep>("platforms");
  
  /* AI 配置状态 */
  const [apiType, setApiType]       = useState<"official"|"thirdparty"|"skip">("skip");
  const [authType, setAuthType]     = useState<"apikey"|"token">("apikey");
  const [apiKey, setApiKey]         = useState("");
  const [authToken, setAuthToken]   = useState("");
  const [baseUrl, setBaseUrl]       = useState("");
  const [model, setModel]           = useState("");
  const [claudeLoading, setClaudeLoading] = useState(true);

  /* load existing Claude settings */
  useEffect(() => {
    (async () => {
      try {
        const d = (await request("/api/claude/settings")) as { contents?: string };
        const raw = (d.contents ?? "").trim();
        if (raw) {
          const s = JSON.parse(raw) as Record<string, unknown>;
          const env = (s.env ?? {}) as Record<string, string>;
          if (env.ANTHROPIC_API_KEY) { setApiType("official"); setAuthType("apikey"); setApiKey(env.ANTHROPIC_API_KEY); }
          else if (env.ANTHROPIC_AUTH_TOKEN && env.ANTHROPIC_BASE_URL) { setApiType("thirdparty"); setAuthToken(env.ANTHROPIC_AUTH_TOKEN); setBaseUrl(env.ANTHROPIC_BASE_URL); setModel(env.ANTHROPIC_MODEL ?? ""); }
          else if (env.ANTHROPIC_AUTH_TOKEN) { setApiType("official"); setAuthType("token"); setAuthToken(env.ANTHROPIC_AUTH_TOKEN); }
        }
      } catch { /* ignore */ }
      setClaudeLoading(false);
    })();
  }, [request]);

  /* ── state updaters ── */
  const upP = useCallback(<K extends PlatformKey>(k: K, p: Partial<WebConfigPayload["platforms"][K]>) => {
    setPl(prev => ({ ...prev, platforms: { ...prev.platforms, [k]: { ...prev.platforms[k], ...p } } }));
  }, []);

  /* ── save Claude API ── */
  const saveClaudeApi = async () => {
    const raw = (await request("/api/claude/settings")) as { contents?: string };
    const existing = JSON.parse((raw.contents ?? "{}").trim() || "{}") as Record<string, unknown>;
    const env = { ...((existing.env ?? {}) as Record<string, string>) };
    if (apiType === "official") {
      if (authType === "apikey" && apiKey.trim()) { env.ANTHROPIC_API_KEY = apiKey.trim(); delete env.ANTHROPIC_AUTH_TOKEN; }
      else if (authType === "token" && authToken.trim()) { env.ANTHROPIC_AUTH_TOKEN = authToken.trim(); delete env.ANTHROPIC_API_KEY; }
    } else if (apiType === "thirdparty") {
      if (authToken.trim()) env.ANTHROPIC_AUTH_TOKEN = authToken.trim();
      if (baseUrl.trim()) env.ANTHROPIC_BASE_URL = baseUrl.trim();
      if (model.trim()) env.ANTHROPIC_MODEL = model.trim();
      delete env.ANTHROPIC_API_KEY;
    }
    await request("/api/claude/settings", { method: "POST", body: JSON.stringify({ contents: JSON.stringify({ ...existing, env }, null, 2) }) });
  };

  /* ── Step 1: 完成平台配置 → 进入 AI 配置 ── */
  const handlePlatformsNext = () => {
    if (!PLATFORM_KEYS.some(k => payload.platforms[k].enabled)) {
      setError("请至少选择并配置一个 IM 平台。");
      return;
    }
    setError("");
    setStep("ai-config");
  };

  /* ── Step 2: 完成 AI 配置 → 保存并启动 ── */
  const saveAndStart = async () => {
    setError(""); setBusy(true);
    try {
      await saveClaudeApi();
      await request("/api/config/save", { method: "POST", body: JSON.stringify(payload) });
      await request("/api/service/start", { method: "POST" });
      setStep("complete");
    } catch (e) { setError(toMsg(e)); } finally { setBusy(false); }
  };

  /* ── 跳过 AI 配置（直接保存） ── */
  const skipAiAndStart = async () => {
    setError(""); setBusy(true);
    try {
      if (apiType !== "skip") {
        await saveClaudeApi();
      }
      await request("/api/config/save", { method: "POST", body: JSON.stringify(payload) });
      await request("/api/service/start", { method: "POST" });
      setStep("complete");
    } catch (e) { setError(toMsg(e)); } finally { setBusy(false); }
  };

  /* ── 已配置平台数量 ── */
  const enabledCount = PLATFORM_KEYS.filter(k => payload.platforms[k].enabled).length;

  /* ═══════════════════════════════════════════════════════ */
  if (step === "complete") {
    return (
      <div className="wizard-wrap">
        <div className="wizard" style={{ textAlign: "center", padding: "48px 32px" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
          <h2 className="wizard-title">{"配置完成！"}</h2>
          <p className="wizard-desc">{"桥接已运行。你现在可以在任何已启用的平台上向机器人发消息了。"}</p>
          <button type="button" className="btn btn-p btn-lg" onClick={onComplete}>{"进入概览"}</button>
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════ */
  return (
    <div className="wizard-wrap">
      <div className="wizard" style={{ maxWidth: 960 }}>
        {/* ── Header ── */}
        <div style={{ padding: "24px 32px 0" }}>
          <h2 className="wizard-title">{"欢迎使用 open-im"}</h2>
          <p className="wizard-desc">{"这个向导将引导你完成 AI 编程助手桥接配置。大约需要 2 分钟。"}</p>
          
          {/* 步骤指示器 */}
          <div className="wizard-steps">
            {[
              { key: "platforms" as const, label: "1. 选择平台" },
              { key: "ai-config" as const, label: "2. AI 工具" },
              { key: "complete" as const, label: "3. 完成" },
            ].map(s => (
              <button
                key={s.key}
                type="button"
                className={`wizard-step-btn ${step === s.key ? "active" : step === "complete" || (step === "ai-config" && s.key === "platforms") ? "done" : ""}`}
                disabled={s.key === "complete"}
                onClick={() => { if (s.key === "platforms") setStep("platforms"); }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* ═══ Step 1: 平台选择 ═══ */}
        {step === "platforms" && (
          <div style={{ padding: "0 32px 24px" }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: "var(--c-text)" }}>
              {"选择要连接的 IM 平台"}
            </h3>
            <p style={{ fontSize: 13, color: "var(--c-text-2)", marginBottom: 16 }}>
              {"选择一个或多个你想接入的聊天平台，微信推荐扫码一键绑定。"}
            </p>
            
            {/* 使用共享的平台配置区域 */}
            <PlatformSection
              payload={payload}
              request={request}
              onChange={upP}
              mode="wizard"
            />

            {/* Footer */}
            <div style={{ 
              padding: "16px 0 0", 
              display: "flex", 
              justifyContent: "space-between", 
              alignItems: "center" 
            }}>
              <span className="form-hint">
                {enabledCount} / {PLATFORM_KEYS.length} 个平台已配置
              </span>
              {error && <div className="msg msg-err" style={{ flex: 1, marginLeft: 16 }}>{error}</div>}
              <button 
                type="button" 
                className="btn btn-p btn-lg" 
                disabled={enabledCount === 0} 
                onClick={() => void handlePlatformsNext()}
              >
                {"下一步：AI 工具配置 →"}
              </button>
            </div>
          </div>
        )}

        {/* ═══ Step 2: AI 工具配置 ═══ */}
        {step === "ai-config" && (
          <div style={{ padding: "0 32px 24px" }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: "var(--c-text)" }}>
              {"AI 工具配置（可选）"}
            </h3>
            <p style={{ fontSize: 13, color: "var(--c-text-2)", marginBottom: 16 }}>
              {"配置 AI 编程助手的 API 凭证。如果已在其他地方配置过，可以跳过此步。"}
            </p>

            {/* AI 工具选择卡片 */}
            <div className="wizard-ai-options">
              {[
                { v: "official" as const, label: "官方 Anthropic API", desc: "使用 Anthropic API Key 或 Auth Token", icon: "🤖" },
                { v: "thirdparty" as const, label: "第三方模型", desc: "使用兼容的第三方 API 端点", icon: "🔗" },
                { v: "skip" as const, label: "跳过", desc: "稍后在设置页面配置", icon: "⏭️" },
              ].map(o => (
                <label key={o.v} className={`wizard-radio ${apiType === o.v ? "on" : ""}`} style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "16px",
                  cursor: "pointer",
                  transition: "all var(--fast)",
                }}>
                  <input type="radio" name="apiType" value={o.v} checked={apiType === o.v} onChange={() => setApiType(o.v)} />
                  <span style={{ fontSize: 24 }}>{o.icon}</span>
                  <span className="wizard-radio-body">
                    <span className="wizard-radio-label">{o.label}</span>
                    <span className="wizard-radio-desc">{o.desc}</span>
                  </span>
                </label>
              ))}
            </div>

            {/* API 详细配置表单 */}
            {apiType !== "skip" && (
              <div className="wizard-api-form" style={{
                background: "var(--c-surface-alt)",
                borderRadius: var => var?.r_l,
                padding: 20,
                marginTop: 16,
                marginBottom: 20,
                border: "1px solid var(--c-border)",
              }}>
                {claudeLoading ? (
                  <p className="form-hint">{"加载中..."}</p>
                ) : (
                  <>
                    {apiType === "official" && (
                      <>
                        <div className="wizard-radio-group" style={{ marginBottom: 12 }}>
                          {[
                            { v: "apikey" as const, label: "API Key", hint: "sk-ant-..." },
                            { v: "token" as const, label: "Auth Token", hint: "claude setup-token" },
                          ].map(o => (
                            <label key={o.v} className={`wizard-radio ${authType === o.v ? "on" : ""}`} style={{ flex: 1 }}>
                              <input type="radio" name="authType" value={o.v} checked={authType === o.v} onChange={() => setAuthType(o.v)} />
                              <span className="wizard-radio-body">
                                <span className="wizard-radio-label">{o.label}</span>
                                <span className="wizard-radio-desc">{o.hint}</span>
                              </span>
                            </label>
                          ))}
                        </div>
                        {authType === "apikey" && (
                          <input 
                            className="form-input mono" 
                            type="password" 
                            placeholder="sk-ant-..." 
                            value={apiKey} 
                            onChange={(e) => setApiKey(e.target.value)}
                          />
                        )}
                        {authType === "token" && (
                          <input 
                            className="form-input mono" 
                            type="password" 
                            placeholder="Auth Token" 
                            value={authToken} 
                            onChange={(e) => setAuthToken(e.target.value)}
                          />
                        )}
                      </>
                    )}
                    
                    {apiType === "thirdparty" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <input className="form-input mono" placeholder="Auth Token" value={authToken} onChange={(e) => setAuthToken(e.target.value)} />
                        <input className="form-input mono" placeholder="Base URL" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
                        <input className="form-input mono" placeholder="Model（如 glm-4.7）" value={model} onChange={(e) => setModel(e.target.value)} />
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* 已选平台摘要 */}
            <div style={{
              background: "var(--c-surface-alt)",
              borderRadius: 8,
              padding: "14px 18px",
              marginBottom: 16,
              border: "1px solid var(--c-border)",
            }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>已选择的平台：</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {PLATFORM_KEYS.filter(k => payload.platforms[k].enabled).map(k => {
                  const def = PLATFORM_DEFINITIONS.find(d => d.key === k);
                  return (
                    <span key={k} style={{
                      background: "var(--c-accent-bg)",
                      color: "var(--c-accent)",
                      padding: "4px 10px",
                      borderRadius: 9999,
                      fontSize: 12,
                      fontWeight: 500,
                    }}>
                      {def?.label || k}
                    </span>
                  );
                })}
                {enabledCount === 0 && (
                  <span style={{ fontSize: 12, color: "var(--c-text-3)" }}>尚未选择任何平台</span>
                )}
              </div>
            </div>

            {/* Footer */}
            <div style={{ 
              padding: "16px 0 0", 
              display: "flex", 
              justifyContent: "space-between", 
              alignItems: "center" 
            }}>
              <button
                type="button"
                className="btn btn-g btn-lg"
                onClick={() => setStep("platforms")}
              >
                {"← 返回修改平台"}
              </button>
              
              {error && <div className="msg msg-err" style={{ flex: 1, marginLeft: 16 }}>{error}</div>}
              
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-s btn-lg"
                  onClick={() => void skipAiAndStart()}
                  disabled={busy}
                >
                  {busy ? "处理中..." : "以后再配"}
                </button>
                <button
                  type="button"
                  className="btn btn-p btn-lg"
                  disabled={busy || (apiType === "skip")}
                  onClick={() => void saveAndStart()}
                >
                  {busy ? "处理中..." : "保存并启动 →"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
