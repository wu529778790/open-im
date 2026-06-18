import { useState, useCallback, useEffect } from "react";
import { PLATFORM_DEFINITIONS, PLATFORM_KEYS } from "../constants.js";
import { PLATFORM_FIELD_LABEL, PLATFORM_SUMMARY_KEY, INLINE_TIP_KEY } from "../fieldLabels.js";
import type { AiCommand, PlatformKey, WebConfigPayload } from "../types.js";

/* ─── helpers ─── */
function toMsg(e: unknown): string { return e instanceof Error ? e.message : String(e); }
function emptyPayload(): WebConfigPayload {
  return {
    platforms: {
      telegram:  { enabled: false, aiCommand: "claude", botToken: "", proxy: "", allowedUserIds: "" },
      feishu:    { enabled: false, aiCommand: "claude", appId: "", appSecret: "", allowedUserIds: "" },
      qq:        { enabled: false, aiCommand: "claude", appId: "", secret: "", allowedUserIds: "" },
      wework:    { enabled: false, aiCommand: "claude", corpId: "", secret: "", allowedUserIds: "" },
      dingtalk:  { enabled: false, aiCommand: "claude", clientId: "", clientSecret: "", cardTemplateId: "", allowedUserIds: "" },
      workbuddy: { enabled: false, aiCommand: "claude", accessToken: "", refreshToken: "", userId: "", baseUrl: "", allowedUserIds: "" },
      clawbot:   { enabled: false, aiCommand: "claude", apiUrl: "http://127.0.0.1:26322", apiToken: "", allowedUserIds: "" },
    },
    ai: { claudeWorkDir: "", claudeConfigPath: "", claudeProxy: "", codexCliPath: "codex", codexProxy: "", codebuddyCliPath: "codebuddy", hookPort: 0, logLevel: "default" },
  };
}

/* ─── types ─── */
type T    = (k: string, p?: Record<string, string | number>) => string;
type Html = (k: string) => string;
type Req  = (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;

interface Props {
  request: Req;
  t: T;
  html: Html;
  onComplete: () => void;
  initialPayload?: WebConfigPayload;
}

/* ═══════════════════════════════════════════════════════ */
export function SetupWizard({ request, t, html, onComplete, initialPayload }: Props) {
  const [payload, setPl] = useState<WebConfigPayload>(initialPayload ?? emptyPayload());
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  /* ── Claude API state ── */
  const [apiType, setApiType]       = useState<"official"|"thirdparty"|"skip">("skip");
  const [authType, setAuthType]     = useState<"apikey"|"token">("apikey");
  const [apiKey, setApiKey]         = useState("");
  const [authToken, setAuthToken]   = useState("");
  const [baseUrl, setBaseUrl]       = useState("");
  const [model, setModel]           = useState("");
  const [claudeLoading, setClaudeLoading] = useState(true);

  /* ── Platform expanded state ── */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  /* ── QR state ── */
  const [qr, setQr]         = useState<"idle"|"loading"|"scanning"|"success"|"error">("idle");
  const [qrUrl, setQrUrl]   = useState("");
  const [qrMsg, setQrMsg]   = useState("");

  /* ── Test state ── */
  const [testBusy, setTestBusy] = useState<PlatformKey | null>(null);
  const [testMsg, setTestMsg]   = useState<Partial<Record<PlatformKey, { text: string; ok: boolean }>>>({});

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

  /* ── QR login ── */
  const qrLogin = async () => {
    setQr("loading"); setQrMsg(""); setQrUrl("");
    try {
      const s = (await request("/api/clawbot/qr-login/start", { method: "POST" })) as { success?: boolean; qrcodeUrl?: string; sessionKey?: string; error?: string };
      if (!s.success || !s.qrcodeUrl || !s.sessionKey) { setQr("error"); setQrMsg(s.error || t("qrLoginFailed")); return; }
      setQrUrl(s.qrcodeUrl); setQr("scanning");
      const w = (await request("/api/clawbot/qr-login/wait", { method: "POST", body: JSON.stringify({ sessionKey: s.sessionKey, qrcode: s.sessionKey, qrcodeUrl: s.qrcodeUrl }) })) as { success?: boolean; botToken?: string; baseUrl?: string; message?: string; error?: string };
      if (w.success && w.botToken) { setQr("success"); setQrMsg(t("qrLoginSuccess")); upP("clawbot", { apiToken: w.botToken, ...(w.baseUrl ? { apiUrl: w.baseUrl } : {}), enabled: true }); }
      else { setQr("error"); setQrMsg(w.message || w.error || t("qrLoginFailed")); }
    } catch (e) { setQr("error"); setQrMsg(toMsg(e)); }
  };

  /* ── test platform ── */
  const testPlatform = async (pk: PlatformKey) => {
    const def = PLATFORM_DEFINITIONS.find(d => d.key === pk); if (!def) return;
    setTestBusy(pk); setTestMsg(m => ({ ...m, [pk]: { text: "", ok: true } }));
    try {
      const cfg: Record<string, string> = {}; def.testFields.forEach(f => { cfg[f] = String((payload.platforms[pk] as Record<string, string>)[f] ?? ""); });
      const r = (await request("/api/config/test", { method: "POST", body: JSON.stringify({ platform: pk, config: cfg }) })) as { success?: boolean; message?: string; error?: string };
      setTestMsg(m => ({ ...m, [pk]: r.success ? { text: r.message || t("testSuccess"), ok: true } : { text: t("testFailed", { error: r.error || "?" }), ok: false } }));
    } catch (e) { setTestMsg(m => ({ ...m, [pk]: { text: t("testFailed", { error: toMsg(e) }), ok: false } })); }
    finally { setTestBusy(null); }
  };

  /* ── save + start ── */
  const saveAndStart = async () => {
    setError(""); setBusy(true);
    try {
      await saveClaudeApi();
      await request("/api/config/save", { method: "POST", body: JSON.stringify(payload) });
      await request("/api/service/start", { method: "POST" });
      setSuccess(true);
    } catch (e) { setError(toMsg(e)); } finally { setBusy(false); }
  };

  /* ── field renderer ── */
  const field = (def: typeof PLATFORM_DEFINITIONS[number], f: string, pk: PlatformKey) => {
    const v = payload.platforms[pk];
    const labels = PLATFORM_FIELD_LABEL[pk as keyof typeof PLATFORM_FIELD_LABEL];
    const lk = labels ? (labels as Record<string, string | undefined>)[f] : undefined;
    const tk = (INLINE_TIP_KEY as Record<string, string | undefined>)[`${pk}-${f}`];
    const isPwd = def.sensitiveFields.includes(f);
    return (
      <div className="form-group" key={f}>
        <label className="form-label">{lk ? t(lk) : f}</label>
        {f === "allowedUserIds" ? (
          <><textarea className="form-textarea mono" value={String((v as Record<string, string>)[f] ?? "")} onChange={(e) => upP(pk, { [f]: e.target.value } as Partial<typeof v>)} /><div className="form-hint">{t("commaSeparatedIds")}</div></>
        ) : f === "aiCommand" ? (
          <select className="form-select" value={String((v as Record<string, string>)[f] || "claude")} onChange={(e) => upP(pk, { aiCommand: e.target.value as AiCommand } as Partial<typeof v>)}><option value="claude">claude</option><option value="codex">codex</option><option value="codebuddy">codebuddy</option><option value="opencode">opencode</option></select>
        ) : (
          <input className="form-input mono" type={isPwd ? "password" : "text"} value={String((v as Record<string, string>)[f] ?? "")} onChange={(e) => upP(pk, { [f]: e.target.value } as Partial<typeof v>)} />
        )}
        {tk && <div className="field-tip" dangerouslySetInnerHTML={{ __html: html(tk) }} />}
      </div>
    );
  };

  /* ═══════════════════════════════════════════════════════ */
  if (success) {
    return (
      <div className="wizard-wrap">
        <div className="wizard" style={{ textAlign: "center", padding: "48px 32px" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
          <h2 className="wizard-title">{t("wizardDoneTitle")}</h2>
          <p className="wizard-desc">{t("wizardDoneDesc")}</p>
          <button type="button" className="btn btn-p btn-lg" onClick={onComplete}>{t("wizardGoToDashboard")}</button>
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════ */
  return (
    <div className="wizard-wrap">
      <div className="wizard" style={{ maxWidth: 900 }}>
        {/* ── Header ── */}
        <div style={{ padding: "24px 32px 0" }}>
          <h2 className="wizard-title">{t("wizardWelcomeTitle")}</h2>
          <p className="wizard-desc">{t("wizardWelcomeDesc")}</p>
        </div>

        {/* ── Claude API ── */}
        <div style={{ padding: "0 32px 24px" }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: "var(--c-text)" }}>{t("wizardClaudeApiTitle")}</h3>
          {claudeLoading ? (
            <p className="form-hint">{t("wizardLoading")}</p>
          ) : (
            <>
              <div className="wizard-radio-group" style={{ marginBottom: 12 }}>
                {[
                  { v: "official" as const,  label: t("wizardApiOfficial"),   desc: t("wizardApiOfficialDesc") },
                  { v: "thirdparty" as const, label: t("wizardApiThirdparty"), desc: t("wizardApiThirdpartyDesc") },
                  { v: "skip" as const,       label: t("wizardApiSkip"),       desc: t("wizardApiSkipDesc") },
                ].map(o => (
                  <label key={o.v} className={`wizard-radio ${apiType === o.v ? "on" : ""}`}>
                    <input type="radio" name="apiType" value={o.v} checked={apiType === o.v} onChange={() => setApiType(o.v)} />
                    <span className="wizard-radio-body">
                      <span className="wizard-radio-label">{o.label}</span>
                      <span className="wizard-radio-desc">{o.desc}</span>
                    </span>
                  </label>
                ))}
              </div>
              {apiType === "official" && (
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  <label className={`wizard-radio ${authType === "apikey" ? "on" : ""}`} style={{ flex: 1 }}>
                    <input type="radio" name="authType" value="apikey" checked={authType === "apikey"} onChange={() => setAuthType("apikey")} />
                    <span className="wizard-radio-body"><span className="wizard-radio-label">API Key</span><span className="wizard-radio-desc">sk-ant-...</span></span>
                  </label>
                  <label className={`wizard-radio ${authType === "token" ? "on" : ""}`} style={{ flex: 1 }}>
                    <input type="radio" name="authType" value="token" checked={authType === "token"} onChange={() => setAuthType("token")} />
                    <span className="wizard-radio-body"><span className="wizard-radio-label">Auth Token</span><span className="wizard-radio-desc">claude setup-token</span></span>
                  </label>
                </div>
              )}
              {apiType === "official" && authType === "apikey" && <input className="form-input mono" type="password" placeholder="sk-ant-..." value={apiKey} onChange={(e) => setApiKey(e.target.value)} />}
              {apiType === "official" && authType === "token" && <input className="form-input mono" type="password" placeholder="Auth Token" value={authToken} onChange={(e) => setAuthToken(e.target.value)} />}
              {apiType === "thirdparty" && (
                <div style={{ display: "flex", gap: 8 }}>
                  <input className="form-input mono" placeholder="Token" value={authToken} onChange={(e) => setAuthToken(e.target.value)} />
                  <input className="form-input mono" placeholder="Base URL" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
                  <input className="form-input mono" placeholder="Model" value={model} onChange={(e) => setModel(e.target.value)} />
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Platforms Grid ── */}
        <div style={{ padding: "0 32px 24px" }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: "var(--c-text)" }}>{t("platformsTitle")}</h3>
          <div className="wizard-chips">
            {PLATFORM_DEFINITIONS.map((def) => {
              const pk = def.key as PlatformKey;
              const on = payload.platforms[pk].enabled;
              const isOpen = expanded[pk];
              const tm = testMsg[pk];
              return (
                <div key={pk} className={`wizard-platform-card ${on ? "on" : ""}`}>
                  <div className="wizard-platform-head" onClick={() => setExpanded(e => ({ ...e, [pk]: !e[pk] }))}>
                    <span className="wizard-platform-name">
                      <span className="dot" />
                      {def.label}
                      <span className="wizard-platform-chevron">{isOpen ? "▾" : "▸"}</span>
                    </span>
                    <label className="toggle" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" className="toggle-input sr-only" checked={on} onChange={(e) => { upP(pk, { enabled: e.target.checked }); if (e.target.checked) setExpanded(ex => ({ ...ex, [pk]: true })); }} />
                      <span className="toggle-track" />
                    </label>
                  </div>
                  {isOpen && (
                    <div className="wizard-platform-body">
                      <p className="form-hint">{t(PLATFORM_SUMMARY_KEY[pk as keyof typeof PLATFORM_SUMMARY_KEY] || "")}</p>
                      {def.fields.map(f => field(def, f, pk))}
                      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                        <button type="button" className="btn btn-s btn-sm" disabled={testBusy === pk} onClick={() => void testPlatform(pk)}>
                          {testBusy === pk ? t("testing") : t("test")}
                        </button>
                        {pk === "clawbot" && (
                          <button type="button" className="btn btn-p btn-sm" disabled={qr === "loading" || qr === "scanning"} onClick={() => void qrLogin()}>
                            {qr === "loading" ? "..." : qr === "scanning" ? t("qrLoginScanning") : t("qrLoginBtn")}
                          </button>
                        )}
                      </div>
                      {tm?.text && <div className={`msg mt-4 ${tm.ok ? "msg-ok" : "msg-err"}`}>{tm.text}</div>}
                      {pk === "clawbot" && qrUrl && qr === "scanning" && (
                        <div style={{ marginTop: 12, textAlign: "center" }}>
                          <img src={qrUrl.startsWith("data:") ? qrUrl : `data:image/png;base64,${qrUrl}`} alt="QR" style={{ width: 160, height: 160, border: "1px solid var(--c-border)", borderRadius: 8 }} />
                        </div>
                      )}
                      {pk === "clawbot" && qrMsg && <div className={`msg mt-4 ${qr === "success" ? "msg-ok" : "msg-err"}`}>{qrMsg}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Footer ── */}
        <div style={{ padding: "16px 32px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="form-hint">
            {PLATFORM_KEYS.filter(k => payload.platforms[k].enabled).length} / {PLATFORM_KEYS.length} {t("platformsTitle")}
          </span>
          {error && <div className="msg msg-err" style={{ flex: 1, marginLeft: 16 }}>{error}</div>}
          <button type="button" className="btn btn-p btn-lg" disabled={busy || !PLATFORM_KEYS.some(k => payload.platforms[k].enabled)} onClick={() => void saveAndStart()}>
            {busy ? t("wizardWorking") : t("wizardFinish")}
          </button>
        </div>
      </div>
    </div>
  );
}
