import { useState, useCallback, useEffect } from "react";
import { PLATFORM_DEFINITIONS, PLATFORM_KEYS } from "../constants.js";
import type { PlatformKey, WebConfigPayload } from "../types.js";
import { PlatformCard } from "./PlatformCard.js";
import { emptyPayload } from "../empty-payload.js";

/* ─── helpers ─── */
function toMsg(e: unknown): string { return e instanceof Error ? e.message : String(e); }

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

        {/* ── Platforms Desk Grid ── */}
        <div style={{ padding: "0 32px 24px" }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: "var(--c-text)" }}>{t("platformsTitle")}</h3>
          <div className="platform-grid">
            {PLATFORM_DEFINITIONS.map((def) => {
              const pk = def.key as PlatformKey;
              return (
                <PlatformCard
                  key={pk}
                  def={def}
                  values={payload.platforms[pk]}
                  t={t}
                  html={html}
                  disabledVisual={!payload.platforms[pk].enabled}
                  request={request}
                  onChange={(p) => upP(pk, p as Partial<WebConfigPayload["platforms"][typeof pk]>)}
                  onTest={() => void testPlatform(pk)}
                  testing={testBusy === pk}
                  testResult={testMsg[pk]}
                />
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
