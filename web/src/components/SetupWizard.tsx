import { useState, useCallback } from "react";
import { PLATFORM_DEFINITIONS, PLATFORM_KEYS } from "../constants.js";
import { PLATFORM_FIELD_LABEL, PLATFORM_SUMMARY_KEY, INLINE_TIP_KEY } from "../fieldLabels.js";
import type { AiCommand, ConfigApiResponse, PlatformKey, WebConfigPayload } from "../types.js";

/* ---------- helpers ---------- */

function toErrorMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function emptyPayload(): WebConfigPayload {
  return {
    platforms: {
      telegram: { enabled: false, aiCommand: "claude", botToken: "", proxy: "", allowedUserIds: "" },
      feishu: { enabled: false, aiCommand: "claude", appId: "", appSecret: "", allowedUserIds: "" },
      qq: { enabled: false, aiCommand: "claude", appId: "", secret: "", allowedUserIds: "" },
      wework: { enabled: false, aiCommand: "claude", corpId: "", secret: "", allowedUserIds: "" },
      dingtalk: { enabled: false, aiCommand: "claude", clientId: "", clientSecret: "", cardTemplateId: "", allowedUserIds: "" },
      workbuddy: { enabled: false, aiCommand: "claude", accessToken: "", refreshToken: "", userId: "", baseUrl: "", allowedUserIds: "" },
      clawbot: { enabled: false, aiCommand: "claude", apiUrl: "http://127.0.0.1:26322", apiToken: "", allowedUserIds: "" },
    },
    ai: {
      claudeWorkDir: "", claudeConfigPath: "", claudeProxy: "",
      codexCliPath: "codex", codexProxy: "", codebuddyCliPath: "codebuddy",
      hookPort: 0, logLevel: "default",
    },
  };
}

/* ---------- types ---------- */

type T = (k: string, p?: Record<string, string | number>) => string;
type Html = (k: string) => string;
type JsonRequest = (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;

interface Props {
  request: JsonRequest;
  t: T;
  html: Html;
  onComplete: () => void; // called after wizard saves successfully
  initialPayload?: WebConfigPayload;
}

/* ---------- step type ---------- */

type Step = "welcome" | "ai" | "platforms" | "credentials" | "review";

const STEPS: Step[] = ["welcome", "ai", "platforms", "credentials", "review"];

function stepIndex(s: Step): number {
  return STEPS.indexOf(s);
}

/* ---------- component ---------- */

export function SetupWizard({ request, t, html, onComplete, initialPayload }: Props) {
  const [step, setStep] = useState<Step>("welcome");
  const [payload, setPayload] = useState<WebConfigPayload>(initialPayload ?? emptyPayload());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [qrState, setQrState] = useState<"idle" | "loading" | "scanning" | "success" | "error">("idle");
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [qrMessage, setQrMessage] = useState("");
  const [startResult, setStartResult] = useState<"idle" | "saving" | "starting" | "done" | "error">("idle");

  /* ---------- state updaters ---------- */
  const updatePlatform = useCallback(<K extends PlatformKey>(key: K, patch: Partial<WebConfigPayload["platforms"][K]>) => {
    setPayload(p => ({
      ...p,
      platforms: { ...p.platforms, [key]: { ...p.platforms[key], ...patch } },
    }));
  }, []);

  const updateAi = useCallback((patch: Partial<WebConfigPayload["ai"]>) => {
    setPayload(p => ({ ...p, ai: { ...p.ai, ...patch } }));
  }, []);

  /* ---------- navigation ---------- */
  const canNext = (): boolean => {
    switch (step) {
      case "welcome":
        return true;
      case "ai":
        return true;
      case "platforms":
        return PLATFORM_KEYS.some(k => payload.platforms[k].enabled);
      case "credentials": {
        return PLATFORM_KEYS
          .filter(k => payload.platforms[k].enabled)
          .every(k => {
            const def = PLATFORM_DEFINITIONS.find(d => d.key === k);
            if (!def) return true;
            return def.requiredFields.every(
              f => String((payload.platforms[k] as Record<string, unknown>)[f] ?? "").trim() !== ""
            );
          });
      }
      case "review":
        return true;
    }
  };

  const goNext = () => {
    const idx = stepIndex(step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]);
  };
  const goBack = () => {
    const idx = stepIndex(step);
    if (idx > 0) setStep(STEPS[idx - 1]);
  };

  /* ---------- QR login (clawbot) ---------- */
  const onQrLogin = async () => {
    setQrState("loading");
    setQrMessage("");
    setQrCodeUrl("");
    try {
      const startRes = (await request("/api/clawbot/qr-login/start")) as {
        success?: boolean; qrcodeUrl?: string; sessionKey?: string; error?: string;
      };
      if (!startRes.success || !startRes.qrcodeUrl || !startRes.sessionKey) {
        setQrState("error");
        setQrMessage(startRes.error || t("qrLoginFailed"));
        return;
      }
      setQrCodeUrl(startRes.qrcodeUrl);
      setQrState("scanning");

      const waitRes = (await request("/api/clawbot/qr-login/wait", {
        method: "POST",
        body: JSON.stringify({
          sessionKey: startRes.sessionKey,
          qrcode: startRes.sessionKey,
          qrcodeUrl: startRes.qrcodeUrl,
        }),
      })) as { success?: boolean; botToken?: string; baseUrl?: string; message?: string; error?: string };

      if (waitRes.success && waitRes.botToken) {
        setQrState("success");
        setQrMessage(t("qrLoginSuccess"));
        updatePlatform("clawbot", {
          apiToken: waitRes.botToken,
          ...(waitRes.baseUrl ? { apiUrl: waitRes.baseUrl } : {}),
          enabled: true,
        });
      } else {
        setQrState("error");
        setQrMessage(waitRes.message || waitRes.error || t("qrLoginFailed"));
      }
    } catch (e) {
      setQrState("error");
      setQrMessage(toErrorMsg(e));
    }
  };

  /* ---------- save + start ---------- */
  const onFinish = async () => {
    setError("");
    setBusy(true);
    setStartResult("saving");
    try {
      await request("/api/config/save", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setStartResult("starting");
      await request("/api/service/start", { method: "POST" });
      setStartResult("done");
    } catch (e) {
      setError(toErrorMsg(e));
      setStartResult("error");
    } finally {
      setBusy(false);
    }
  };

  /* ---------- render helpers ---------- */
  const stepIdx = stepIndex(step);
  const progress = ((stepIdx + 1) / STEPS.length) * 100;

  const fieldInput = (def: typeof PLATFORM_DEFINITIONS[number], field: string, pk: PlatformKey) => {
    const vals = payload.platforms[pk];
    const fieldLabels = PLATFORM_FIELD_LABEL[pk as keyof typeof PLATFORM_FIELD_LABEL];
    const labelKey = fieldLabels ? (fieldLabels as Record<string, string | undefined>)[field] : undefined;
    const tipId = `${pk}-${field}`;
    const tipKey = (INLINE_TIP_KEY as Record<string, string | undefined>)[tipId];
    const isPassword = def.sensitiveFields.includes(field);

    return (
      <div className="form-group" key={field}>
        <label className="form-label">{labelKey ? t(labelKey) : field}</label>
        {field === "allowedUserIds" ? (
          <>
            <textarea
              className="form-textarea mono"
              value={String((vals as Record<string, string>)[field] ?? "")}
              onChange={(e) => updatePlatform(pk, { [field]: e.target.value } as Partial<typeof vals>)}
            />
            <div className="form-hint">{t("commaSeparatedIds")}</div>
          </>
        ) : field === "aiCommand" ? (
          <select
            className="form-select"
            value={String((vals as Record<string, string>)[field] || "claude")}
            onChange={(e) => updatePlatform(pk, { aiCommand: e.target.value as AiCommand } as Partial<typeof vals>)}
          >
            <option value="claude">claude</option>
            <option value="codex">codex</option>
            <option value="codebuddy">codebuddy</option>
          </select>
        ) : (
          <input
            className="form-input mono"
            type={isPassword ? "password" : "text"}
            value={String((vals as Record<string, string>)[field] ?? "")}
            onChange={(e) => updatePlatform(pk, { [field]: e.target.value } as Partial<typeof vals>)}
          />
        )}
        {tipKey ? (
          <div className="field-inline-tip" dangerouslySetInnerHTML={{ __html: html(tipKey) }} />
        ) : null}
      </div>
    );
  };

  /* ---------- step content ---------- */
  const renderStep = () => {
    switch (step) {
      case "welcome":
        return (
          <div className="wizard-step">
            <div className="wizard-step-icon">🚀</div>
            <h2 className="wizard-step-title">{t("wizardWelcomeTitle")}</h2>
            <p className="wizard-step-desc">{t("wizardWelcomeDesc")}</p>
            <div className="wizard-steps-list">
              <div className="wizard-steps-item">
                <span className="wizard-steps-num">1</span>
                <span>{t("wizardStepAi")}</span>
              </div>
              <div className="wizard-steps-item">
                <span className="wizard-steps-num">2</span>
                <span>{t("wizardStepPlatforms")}</span>
              </div>
              <div className="wizard-steps-item">
                <span className="wizard-steps-num">3</span>
                <span>{t("wizardStepCredentials")}</span>
              </div>
              <div className="wizard-steps-item">
                <span className="wizard-steps-num">4</span>
                <span>{t("wizardStepReview")}</span>
              </div>
            </div>
          </div>
        );

      case "ai":
        return (
          <div className="wizard-step">
            <h2 className="wizard-step-title">{t("wizardAiTitle")}</h2>
            <p className="wizard-step-desc">{t("wizardAiDesc")}</p>
            <div className="form-group">
              <label className="form-label">{t("workDir")}</label>
              <input
                className="form-input mono"
                placeholder="/path/to/project"
                value={payload.ai.claudeWorkDir}
                onChange={(e) => updateAi({ claudeWorkDir: e.target.value })}
              />
              <p className="form-hint">{t("wizardWorkDirHint")}</p>
            </div>
            <div className="form-group">
              <label className="form-label">{t("codexCli")}</label>
              <input className="form-input mono" value={payload.ai.codexCliPath} onChange={(e) => updateAi({ codexCliPath: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">{t("codebuddyCli")}</label>
              <input className="form-input mono" value={payload.ai.codebuddyCliPath} onChange={(e) => updateAi({ codebuddyCliPath: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">{t("logLevel")}</label>
              <select className="form-select" value={payload.ai.logLevel} onChange={(e) => updateAi({ logLevel: e.target.value })}>
                <option value="default">{t("logLevelDefault")}</option>
                <option value="DEBUG">DEBUG</option>
                <option value="INFO">INFO</option>
                <option value="WARN">WARN</option>
                <option value="ERROR">ERROR</option>
              </select>
            </div>
          </div>
        );

      case "platforms":
        return (
          <div className="wizard-step">
            <h2 className="wizard-step-title">{t("wizardPlatformsTitle")}</h2>
            <p className="wizard-step-desc">{t("wizardPlatformsDesc")}</p>
            <div className="wizard-platform-grid">
              {PLATFORM_DEFINITIONS.map((def) => {
                const pk = def.key as PlatformKey;
                const enabled = payload.platforms[pk].enabled;
                return (
                  <button
                    key={pk}
                    type="button"
                    className={`wizard-platform-chip ${enabled ? "selected" : ""}`}
                    onClick={() => updatePlatform(pk, { enabled: !enabled })}
                  >
                    <div className="wizard-platform-chip-name">{def.label}</div>
                    <div className="wizard-platform-chip-hint">
                      {t(PLATFORM_SUMMARY_KEY[pk as keyof typeof PLATFORM_SUMMARY_KEY] || "")}
                    </div>
                  </button>
                );
              })}
            </div>
            {!PLATFORM_KEYS.some(k => payload.platforms[k].enabled) && (
              <p className="form-hint" style={{ color: "var(--warning-text)", marginTop: 12 }}>
                {t("wizardPickAtLeastOne")}
              </p>
            )}
          </div>
        );

      case "credentials":
        return (
          <div className="wizard-step">
            <h2 className="wizard-step-title">{t("wizardCredentialsTitle")}</h2>
            <p className="wizard-step-desc">{t("wizardCredentialsDesc")}</p>
            {PLATFORM_KEYS.filter(k => payload.platforms[k].enabled).map(pk => {
              const def = PLATFORM_DEFINITIONS.find(d => d.key === pk)!;
              return (
                <div key={pk} className="wizard-credential-card">
                  <h3 className="wizard-credential-name">{def.label}</h3>
                  {def.fields.map(f => fieldInput(def, f, pk))}
                  {pk === "clawbot" && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={qrState === "loading" || qrState === "scanning"}
                          onClick={() => void onQrLogin()}
                        >
                          {qrState === "loading" ? "..." : qrState === "scanning" ? t("qrLoginScanning") : t("qrLoginBtn")}
                        </button>
                        {qrState === "scanning" ? <span className="form-hint">{t("qrScanHint")}</span> : null}
                      </div>
                      {qrCodeUrl && qrState === "scanning" && (
                        <div style={{ marginTop: 12, textAlign: "center" }}>
                          <img
                            src={qrCodeUrl.startsWith("data:") ? qrCodeUrl : `data:image/png;base64,${qrCodeUrl}`}
                            alt="QR Code"
                            style={{ width: 180, height: 180, border: "1px solid var(--border)", borderRadius: 8 }}
                          />
                        </div>
                      )}
                      {qrMessage && (
                        <div className={`message mt-4 ${qrState === "success" ? "message-success" : qrState === "error" ? "message-error" : ""}`}>
                          {qrMessage}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );

      case "review":
        return (
          <div className="wizard-step">
            <h2 className="wizard-step-title">{t("wizardReviewTitle")}</h2>
            <p className="wizard-step-desc">{t("wizardReviewDesc")}</p>

            {startResult === "done" ? (
              <div className="wizard-done">
                <div className="wizard-step-icon">✅</div>
                <h2 className="wizard-step-title">{t("wizardDoneTitle")}</h2>
                <p className="wizard-step-desc">{t("wizardDoneDesc")}</p>
                <button type="button" className="btn btn-primary" onClick={onComplete}>
                  {t("wizardGoToDashboard")}
                </button>
              </div>
            ) : (
              <>
                <div className="wizard-review-section">
                  <h3 className="wizard-review-heading">{t("aiTitle")}</h3>
                  <div className="wizard-review-kv">
                    <span>{t("workDir")}</span>
                    <code>{payload.ai.claudeWorkDir || "—"}</code>
                  </div>
                  <div className="wizard-review-kv">
                    <span>{t("codexCli")}</span>
                    <code>{payload.ai.codexCliPath}</code>
                  </div>
                  <div className="wizard-review-kv">
                    <span>{t("logLevel")}</span>
                    <code>{payload.ai.logLevel}</code>
                  </div>
                </div>

                <div className="wizard-review-section">
                  <h3 className="wizard-review-heading">{t("platformsTitle")}</h3>
                  <div className="wizard-review-platforms">
                    {PLATFORM_KEYS.filter(k => payload.platforms[k].enabled).map(pk => {
                      const def = PLATFORM_DEFINITIONS.find(d => d.key === pk)!;
                      const cmd = (payload.platforms[pk] as { aiCommand?: string }).aiCommand || "claude";
                      return (
                        <div key={pk} className="wizard-review-platform-badge">
                          <strong>{def.label}</strong>
                          <span className="wizard-review-platform-cmd">{cmd}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {error && <div className="message message-error" style={{ marginTop: 16 }}>{error}</div>}

                {startResult !== "idle" && startResult !== "error" && (
                  <div className="wizard-progress-indicator">
                    {startResult === "saving" && t("wizardSaving")}
                    {startResult === "starting" && t("wizardStarting")}
                  </div>
                )}
              </>
            )}
          </div>
        );
    }
  };

  /* ---------- main render ---------- */
  return (
    <div className="wizard">
      {/* progress bar */}
      <div className="wizard-progress-bar">
        <div className="wizard-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      {/* step labels */}
      <div className="wizard-step-labels">
        {STEPS.map((s, i) => (
          <button
            key={s}
            type="button"
            className={`wizard-step-label ${i === stepIdx ? "active" : i < stepIdx ? "done" : ""}`}
            onClick={() => { if (i < stepIdx) setStep(s); }}
            disabled={i > stepIdx}
          >
            <span className="wizard-step-label-num">{i + 1}</span>
            <span className="wizard-step-label-text">{t(`wizardStepLabel_${s}`)}</span>
          </button>
        ))}
      </div>

      {/* step content */}
      <div className="wizard-content">
        {renderStep()}
      </div>

      {/* nav buttons */}
      {startResult !== "done" && (
        <div className="wizard-nav">
          {stepIdx > 0 && (
            <button type="button" className="btn btn-secondary" onClick={goBack} disabled={busy}>
              {t("wizardBack")}
            </button>
          )}
          <div style={{ flex: 1 }} />
          {step === "review" ? (
            <button type="button" className="btn btn-primary" onClick={() => void onFinish()} disabled={busy || !canNext()}>
              {busy ? t("wizardWorking") : t("wizardFinish")}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={goNext} disabled={!canNext()}>
              {t("wizardNext")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
