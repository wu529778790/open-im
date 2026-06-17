import { useState, useCallback } from "react";
import { PLATFORM_DEFINITIONS, PLATFORM_KEYS } from "../constants.js";
import { PLATFORM_FIELD_LABEL, PLATFORM_SUMMARY_KEY, INLINE_TIP_KEY } from "../fieldLabels.js";
import type { AiCommand, PlatformKey, WebConfigPayload } from "../types.js";

function toMsg(e: unknown): string { return e instanceof Error ? e.message : String(e); }
function emptyPayload(): WebConfigPayload {
  return {
    platforms: {
      telegram:    { enabled: false, aiCommand: "claude", botToken: "", proxy: "", allowedUserIds: "" },
      feishu:      { enabled: false, aiCommand: "claude", appId: "", appSecret: "", allowedUserIds: "" },
      qq:          { enabled: false, aiCommand: "claude", appId: "", secret: "", allowedUserIds: "" },
      wework:      { enabled: false, aiCommand: "claude", corpId: "", secret: "", allowedUserIds: "" },
      dingtalk:    { enabled: false, aiCommand: "claude", clientId: "", clientSecret: "", cardTemplateId: "", allowedUserIds: "" },
      workbuddy:   { enabled: false, aiCommand: "claude", accessToken: "", refreshToken: "", userId: "", baseUrl: "", allowedUserIds: "" },
      clawbot:     { enabled: false, aiCommand: "claude", apiUrl: "http://127.0.0.1:26322", apiToken: "", allowedUserIds: "" },
    },
    ai: { claudeWorkDir: "", claudeConfigPath: "", claudeProxy: "", codexCliPath: "codex", codexProxy: "", codebuddyCliPath: "codebuddy", hookPort: 0, logLevel: "default" },
  };
}

type T    = (k: string, p?: Record<string, string | number>) => string;
type Html = (k: string) => string;
type Req  = (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;
type Step = "welcome" | "ai" | "platforms" | "credentials" | "review";

const STEPS: Step[] = ["welcome", "ai", "platforms", "credentials", "review"];

interface Props {
  request: Req;
  t: T;
  html: Html;
  onComplete: () => void;
  initialPayload?: WebConfigPayload;
}

export function SetupWizard({ request, t, html, onComplete, initialPayload }: Props) {
  const [step, setStep]     = useState<Step>("welcome");
  const [payload, setPl]    = useState<WebConfigPayload>(initialPayload ?? emptyPayload());
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState("");
  const [qr, setQr]         = useState<"idle"|"loading"|"scanning"|"success"|"error">("idle");
  const [qrUrl, setQrUrl]   = useState("");
  const [qrMsg, setQrMsg]   = useState("");
  const [result, setResult] = useState<"idle"|"saving"|"starting"|"done"|"error">("idle");

  const idx = STEPS.indexOf(step);

  const upP = useCallback(<K extends PlatformKey>(k: K, p: Partial<WebConfigPayload["platforms"][K]>) => {
    setPl(prev => ({ ...prev, platforms: { ...prev.platforms, [k]: { ...prev.platforms[k], ...p } } }));
  }, []);
  const upA = useCallback((p: Partial<WebConfigPayload["ai"]>) => {
    setPl(prev => ({ ...prev, ai: { ...prev.ai, ...p } }));
  }, []);

  const canNext = (): boolean => {
    if (step === "welcome" || step === "ai") return true;
    if (step === "platforms") return PLATFORM_KEYS.some(k => payload.platforms[k].enabled);
    if (step === "credentials") return PLATFORM_KEYS.filter(k => payload.platforms[k].enabled).every(k => {
      const def = PLATFORM_DEFINITIONS.find(d => d.key === k);
      return def ? def.requiredFields.every(f => String((payload.platforms[k] as Record<string, unknown>)[f] ?? "").trim() !== "") : true;
    });
    return true;
  };
  const next = () => { if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]); };
  const back = () => { if (idx > 0) setStep(STEPS[idx - 1]); };

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

  const finish = async () => {
    setError(""); setBusy(true); setResult("saving");
    try {
      await request("/api/config/save", { method: "POST", body: JSON.stringify(payload) });
      setResult("starting");
      await request("/api/service/start", { method: "POST" });
      setResult("done");
    } catch (e) { setError(toMsg(e)); setResult("error"); } finally { setBusy(false); }
  };

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
          <select className="form-select" value={String((v as Record<string, string>)[f] || "claude")} onChange={(e) => upP(pk, { aiCommand: e.target.value as AiCommand } as Partial<typeof v>)}><option value="claude">claude</option><option value="codex">codex</option><option value="codebuddy">codebuddy</option></select>
        ) : (
          <input className="form-input mono" type={isPwd ? "password" : "text"} value={String((v as Record<string, string>)[f] ?? "")} onChange={(e) => upP(pk, { [f]: e.target.value } as Partial<typeof v>)} />
        )}
        {tk && <div className="field-tip" dangerouslySetInnerHTML={{ __html: html(tk) }} />}
      </div>
    );
  };

  /* ── step content ── */
  const content = () => {
    switch (step) {
      case "welcome":
        return (
          <>
            <div className="wizard-icon">🚀</div>
            <h2 className="wizard-title">{t("wizardWelcomeTitle")}</h2>
            <p className="wizard-desc">{t("wizardWelcomeDesc")}</p>
            <div className="wizard-checklist">
              {[t("wizardStepAi"), t("wizardStepPlatforms"), t("wizardStepCredentials"), t("wizardStepReview")].map((s, i) => (
                <div className="wizard-check" key={i}><span className="wizard-check-num">{i + 1}</span>{s}</div>
              ))}
            </div>
          </>
        );
      case "ai":
        return (
          <>
            <h2 className="wizard-title">{t("wizardAiTitle")}</h2>
            <p className="wizard-desc">{t("wizardAiDesc")}</p>
            <div className="form-group">
              <label className="form-label">{t("workDir")}</label>
              <input className="form-input mono" placeholder="/path/to/project" value={payload.ai.claudeWorkDir} onChange={(e) => upA({ claudeWorkDir: e.target.value })} />
              <p className="form-hint">{t("wizardWorkDirHint")}</p>
            </div>
            <div className="form-group">
              <label className="form-label">{t("codexCli")}</label>
              <input className="form-input mono" value={payload.ai.codexCliPath} onChange={(e) => upA({ codexCliPath: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">{t("codebuddyCli")}</label>
              <input className="form-input mono" value={payload.ai.codebuddyCliPath} onChange={(e) => upA({ codebuddyCliPath: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">{t("logLevel")}</label>
              <select className="form-select" value={payload.ai.logLevel} onChange={(e) => upA({ logLevel: e.target.value })}>
                <option value="default">{t("logLevelDefault")}</option><option value="DEBUG">DEBUG</option><option value="INFO">INFO</option><option value="WARN">WARN</option><option value="ERROR">ERROR</option>
              </select>
            </div>
          </>
        );
      case "platforms":
        return (
          <>
            <h2 className="wizard-title">{t("wizardPlatformsTitle")}</h2>
            <p className="wizard-desc">{t("wizardPlatformsDesc")}</p>
            <div className="wizard-chips">
              {PLATFORM_DEFINITIONS.map((def) => {
                const pk = def.key as PlatformKey;
                const on = payload.platforms[pk].enabled;
                return (
                  <button key={pk} type="button" className={`wizard-chip ${on ? "on" : ""}`} onClick={() => upP(pk, { enabled: !on })}>
                    <span className="wizard-chip-name">{def.label}</span>
                    <span className="wizard-chip-hint">{t(PLATFORM_SUMMARY_KEY[pk as keyof typeof PLATFORM_SUMMARY_KEY] || "")}</span>
                  </button>
                );
              })}
            </div>
            {!PLATFORM_KEYS.some(k => payload.platforms[k].enabled) && <p className="form-hint" style={{ color: "var(--c-warn)", marginTop: 12 }}>{t("wizardPickAtLeastOne")}</p>}
          </>
        );
      case "credentials":
        return (
          <>
            <h2 className="wizard-title">{t("wizardCredentialsTitle")}</h2>
            <p className="wizard-desc">{t("wizardCredentialsDesc")}</p>
            {PLATFORM_KEYS.filter(k => payload.platforms[k].enabled).map(pk => {
              const def = PLATFORM_DEFINITIONS.find(d => d.key === pk)!;
              return (
                <div key={pk} className="wizard-cred">
                  <h3 className="wizard-cred-name">{def.label}</h3>
                  {def.fields.map(f => field(def, f, pk))}
                  {pk === "clawbot" && (
                    <div style={{ marginTop: 14 }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <button type="button" className="btn btn-p btn-sm" disabled={qr === "loading" || qr === "scanning"} onClick={() => void qrLogin()}>
                          {qr === "loading" ? "..." : qr === "scanning" ? t("qrLoginScanning") : t("qrLoginBtn")}
                        </button>
                        {qr === "scanning" && <span className="form-hint">{t("qrScanHint")}</span>}
                      </div>
                      {qrUrl && qr === "scanning" && <div style={{ marginTop: 12, textAlign: "center" }}><img src={qrUrl.startsWith("data:") ? qrUrl : `data:image/png;base64,${qrUrl}`} alt="QR" style={{ width: 160, height: 160, border: "1px solid var(--c-border)", borderRadius: 8 }} /></div>}
                      {qrMsg && <div className={`msg mt-4 ${qr === "success" ? "msg-ok" : "msg-err"}`}>{qrMsg}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        );
      case "review":
        if (result === "done") {
          return (
            <div className="wizard-done">
              <div className="wizard-icon">✅</div>
              <h2 className="wizard-title">{t("wizardDoneTitle")}</h2>
              <p className="wizard-desc">{t("wizardDoneDesc")}</p>
              <button type="button" className="btn btn-p" onClick={onComplete}>{t("wizardGoToDashboard")}</button>
            </div>
          );
        }
        return (
          <>
            <h2 className="wizard-title">{t("wizardReviewTitle")}</h2>
            <p className="wizard-desc">{t("wizardReviewDesc")}</p>
            <div className="wizard-review-block">
              <div className="wizard-review-head">{t("aiTitle")}</div>
              <div className="wizard-kv"><span>{t("workDir")}</span><code>{payload.ai.claudeWorkDir || "—"}</code></div>
              <div className="wizard-kv"><span>{t("codexCli")}</span><code>{payload.ai.codexCliPath}</code></div>
              <div className="wizard-kv"><span>{t("logLevel")}</span><code>{payload.ai.logLevel}</code></div>
            </div>
            <div className="wizard-review-block">
              <div className="wizard-review-head">{t("platformsTitle")}</div>
              <div className="wizard-platforms">
                {PLATFORM_KEYS.filter(k => payload.platforms[k].enabled).map(pk => {
                  const def = PLATFORM_DEFINITIONS.find(d => d.key === pk)!;
                  const cmd = (payload.platforms[pk] as { aiCommand?: string }).aiCommand || "claude";
                  return <span key={pk} className="wizard-platform-pill"><strong>{def.label}</strong><span className="cmd">{cmd}</span></span>;
                })}
              </div>
            </div>
            {error && <div className="msg msg-err mt-4">{error}</div>}
            {result !== "idle" && result !== "error" && <p className="form-hint text-center mt-4 wizard-pulse">{result === "saving" ? t("wizardSaving") : t("wizardStarting")}</p>}
          </>
        );
    }
  };

  const pct = ((idx + 1) / STEPS.length) * 100;

  return (
    <div className="wizard-wrap">
      <div className="wizard">
        <div className="wizard-bar"><div className="wizard-bar-fill" style={{ width: `${pct}%` }} /></div>
        <div className="wizard-steps">
          {STEPS.map((s, i) => (
            <div key={s} className={`wizard-step-ind ${i === idx ? "active" : ""} ${i < idx ? "done" : ""}`}>
              <span className="wizard-step-dot">{i < idx ? "✓" : i + 1}</span>
              <span className="wizard-step-label">{t(`wizardStepLabel_${s}`)}</span>
            </div>
          ))}
        </div>
        <div className="wizard-body">{content()}</div>
        {result !== "done" && (
          <div className="wizard-nav">
            {idx > 0 && <button type="button" className="btn btn-s" onClick={back} disabled={busy}>{t("wizardBack")}</button>}
            <div className="wizard-nav-spacer" />
            {step === "review" ? (
              <button type="button" className="btn btn-p" onClick={() => void finish()} disabled={busy || !canNext()}>{busy ? t("wizardWorking") : t("wizardFinish")}</button>
            ) : (
              <button type="button" className="btn btn-p" onClick={next} disabled={!canNext()}>{t("wizardNext")}</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
