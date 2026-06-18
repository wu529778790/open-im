import { useCallback, useEffect, useRef, useState } from "react";
import { PLATFORM_DEFINITIONS, PLATFORM_KEYS, POLLING_INTERVAL_MS, STORAGE_KEY_DARK_MODE, STORAGE_KEY_LANG } from "./constants.js";
import { useI18n, type Lang } from "./hooks/useI18n.js";
import type { AiCommand, ConfigApiResponse, PlatformKey, WebConfigPayload } from "./types.js";
import { useApi } from "./context/ApiContext.js";
import { Header } from "./components/Header.js";
import { OverviewStats } from "./components/OverviewStats.js";
import { PlatformCard } from "./components/PlatformCard.js";
import { AiConfigSection } from "./components/AiConfigSection.js";
import { ConfigFilesSection } from "./components/ConfigFilesSection.js";
import { SetupWizard } from "./components/SetupWizard.js";

function toMsg(e: unknown): string { return e instanceof Error ? e.message : String(e); }
function pretty(raw: string): string { return JSON.stringify(JSON.parse(raw), null, 2) + "\n"; }
function normCmd(v: unknown): AiCommand { return v === "codex" || v === "codebuddy" || v === "claude" || v === "" ? (v as AiCommand) : "claude"; }

function emptyP(): WebConfigPayload {
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
    ai: { claudeWorkDir: "", claudeConfigPath: "", claudeProxy: "", codexCliPath: "codex", codexProxy: "", codebuddyCliPath: "codebuddy", hookPort: 0, logLevel: "default" },
  };
}

function coerce(raw: WebConfigPayload): WebConfigPayload {
  const base = emptyP();
  const mp = <K extends PlatformKey>(k: K) => { const m = { ...base.platforms[k], ...raw.platforms[k] }; return { ...m, aiCommand: normCmd(m.aiCommand) }; };
  return {
    platforms: { telegram: mp("telegram"), feishu: mp("feishu"), qq: mp("qq"), wework: mp("wework"), dingtalk: mp("dingtalk"), workbuddy: mp("workbuddy"), clawbot: mp("clawbot") },
    ai: { ...base.ai, ...raw.ai, hookPort: typeof raw.ai.hookPort === "number" ? raw.ai.hookPort : Number(raw.ai.hookPort) || 0 },
  };
}

export function Dashboard() {
  const R = useApi();
  const [lang, setLang] = useState<Lang>(() => { const s = localStorage.getItem(STORAGE_KEY_LANG) || ""; return s.startsWith("zh") || navigator.language.startsWith("zh") ? "zh" : "en"; });
  const { t, html } = useI18n(lang);
  const [pl, setPl] = useState<WebConfigPayload>(emptyP);
  const [meta, setMeta] = useState({ configPath: "" });
  const [claudeJ, setClaudeJ] = useState("");
  const [codexJ, setCodexJ] = useState("");
  const [cfgJ, setCfgJ] = useState("");
  const [origCfgJ, setOrigCfgJ] = useState("");
  const [msg, setMsg] = useState<{ text: string; type: "success" | "error" | "" }>({ text: "", type: "" });
  const [busy, setBusy] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [svc, setSvc] = useState<{ running: boolean; pid?: number }>({ running: false });
  const [jv, setJv] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [tBusy, setTBusy] = useState<PlatformKey | null>(null);
  const [tMsg, setTMsg] = useState<Partial<Record<PlatformKey, { text: string; ok: boolean }>>>({});

  const refreshSvc = useCallback(async () => { const d = (await R("/api/service/status")) as { running?: boolean; pid?: number }; const n = { running: Boolean(d.running), pid: d.pid }; setSvc(p => p.running === n.running && p.pid === n.pid ? p : n); return d; }, [R]);
  const refreshH = useCallback(async () => { try { const d = (await R("/api/health")) as Record<string, unknown>; setHealth(p => p && JSON.stringify(p) === JSON.stringify(d) ? p : d); } catch {} }, [R]);

  useEffect(() => {
    let ok = true;
    (async () => {
      setBusy(true); setMsg({ text: "", type: "" });
      try {
        const d = (await R("/api/config")) as ConfigApiResponse;
        if (!ok) return;
        const c = coerce(d.payload); setPl(c); setMeta({ configPath: d.meta.configPath });
        if (!PLATFORM_KEYS.some(k => c.platforms[k].enabled)) setShowWizard(true);
        const [cl, cx, fj] = await Promise.all([
          R("/api/claude/settings") as Promise<{ contents?: string }>,
          R("/api/codex/settings") as Promise<{ contents?: string }>,
          R("/api/config/file") as Promise<{ contents?: string }>,
          refreshSvc(), refreshH(),
        ]);
        if (!ok) return;
        const fmt = (r: string | undefined, fb: string) => { const s = (r ?? "").trim(); if (!s) return fb; try { return pretty(s); } catch { return s; } };
        setClaudeJ(fmt(cl.contents, "{\n}\n")); setCodexJ(fmt(cx.contents, "{\n}\n"));
        const rj = (fj.contents ?? "").trim(); setOrigCfgJ(rj); setCfgJ(fmt(fj.contents, "{}\n"));
      } catch (e) { if (ok) setMsg({ text: toMsg(e), type: "error" }); } finally { if (ok) setBusy(false); }
    })();
    return () => { ok = false; };
  }, [R, refreshH, refreshSvc]);

  useEffect(() => { const id = window.setInterval(() => { void refreshSvc(); void refreshH(); }, POLLING_INTERVAL_MS); return () => window.clearInterval(id); }, [refreshH, refreshSvc]);

  const validateJson = useCallback(() => { try { JSON.parse(cfgJ); setJv({ text: t("jsonValid"), type: "success" }); } catch (e) { setJv({ text: t("jsonInvalid", { error: e instanceof Error ? e.message : String(e) }), type: "error" }); } }, [cfgJ, t]);
  useEffect(() => { validateJson(); }, [cfgJ, validateJson]);

  const buildP = useCallback((): WebConfigPayload => ({ ...pl, ai: { ...pl.ai, hookPort: Number(pl.ai.hookPort) || 0 } }), [pl]);
  const clientErrs = useCallback((): string[] => {
    const es: string[] = [];
    if (!PLATFORM_KEYS.some(k => pl.platforms[k].enabled)) es.push(t("validationNoPlatformEnabled"));
    PLATFORM_DEFINITIONS.forEach(d => {
      if (!pl.platforms[d.key as PlatformKey].enabled) return;
      const m = d.requiredFields.filter(f => !String((pl.platforms[d.key as PlatformKey] as Record<string, unknown>)[f] ?? "").trim());
      if (m.length) es.push(t("validationPlatformIncomplete", { platform: d.label, fields: m.join(", ") }));
    });
    return es;
  }, [pl, t]);

  const onValidate = async () => { const e = clientErrs(); if (e.length) { setMsg({ text: e.join(" "), type: "error" }); return; } setBusy(true); try { await R("/api/config/validate", { method: "POST", body: JSON.stringify(buildP()) }); setMsg({ text: t("validationOk"), type: "success" }); } catch (x) { setMsg({ text: toMsg(x), type: "error" }); } finally { setBusy(false); } };
  const saveClaude = async () => { await R("/api/claude/settings", { method: "POST", body: JSON.stringify({ contents: claudeJ }) }); };
  const saveCodex = async () => { await R("/api/codex/settings", { method: "POST", body: JSON.stringify({ contents: codexJ }) }); };
  const saveCfg = async () => { const j = cfgJ.trim(); if (!j) return; JSON.parse(j); await R("/api/config/file", { method: "POST", body: JSON.stringify({ contents: j }) }); setOrigCfgJ(j); };
  const onSave = async () => { const e = clientErrs(); if (e.length) { setMsg({ text: e.join(" "), type: "error" }); return; } setBusy(true); try { await Promise.all([saveClaude(), saveCodex(), saveCfg()]); await R("/api/config/save?final=1", { method: "POST", body: JSON.stringify(buildP()) }); setMsg({ text: t("saveOk"), type: "success" }); } catch (x) { setMsg({ text: toMsg(x), type: "error" }); } finally { setBusy(false); } };
  const onStart = async () => { const e = clientErrs(); if (e.length) { setMsg({ text: e.join(" "), type: "error" }); return; } setBusy(true); try { await Promise.all([saveClaude(), saveCodex(), R("/api/config/save", { method: "POST", body: JSON.stringify(buildP()) })]); await R("/api/service/start", { method: "POST" }); await Promise.all([refreshSvc(), refreshH()]); setMsg({ text: t("startOk"), type: "success" }); } catch (x) { setMsg({ text: toMsg(x), type: "error" }); } finally { setBusy(false); } };
  const onStop = async () => { setBusy(true); try { await R("/api/service/stop", { method: "POST" }); await refreshSvc(); setMsg({ text: t("stopOk"), type: "success" }); } catch (x) { setMsg({ text: toMsg(x), type: "error" }); } finally { setBusy(false); } };
  const onToggle = async () => { if (svc.running) await onStop(); else await onStart(); };

  const onTest = async (pk: PlatformKey) => {
    const def = PLATFORM_DEFINITIONS.find(d => d.key === pk); if (!def) return;
    setTBusy(pk); setTMsg(m => ({ ...m, [pk]: { text: "", ok: true } }));
    try {
      const cfg: Record<string, string> = {}; def.testFields.forEach(f => { cfg[f] = String((pl.platforms[pk] as Record<string, string>)[f] ?? ""); });
      const r = (await R("/api/config/test", { method: "POST", body: JSON.stringify({ platform: pk, config: cfg }) })) as { success?: boolean; message?: string; error?: string };
      setTMsg(m => ({ ...m, [pk]: r.success ? { text: r.message || t("testSuccess"), ok: true } : { text: t("testFailed", { error: r.error || "?" }), ok: false } }));
    } catch (x) { setTMsg(m => ({ ...m, [pk]: { text: t("testFailed", { error: toMsg(x) }), ok: false } })); }
    finally { setTBusy(null); }
  };

  const upP = <K extends PlatformKey>(k: K, p: Partial<WebConfigPayload["platforms"][K]>) => { setPl(prev => ({ ...prev, platforms: { ...prev.platforms, [k]: { ...prev.platforms[k], ...p } } })); };
  const upA = (p: Partial<WebConfigPayload["ai"]>) => { setPl(prev => ({ ...prev, ai: { ...prev.ai, ...p } })); };
  const fmtJson = () => { try { setCfgJ(pretty(cfgJ)); } catch { setJv({ text: t("jsonInvalid", { error: "parse" }), type: "error" }); } };
  const resetJson = () => setCfgJ(origCfgJ ? `${origCfgJ}\n` : "{}\n");
  const toggleLang = () => { const n: Lang = lang === "zh" ? "en" : "zh"; setLang(n); localStorage.setItem(STORAGE_KEY_LANG, n); };
  const toggleDark = () => { const n = !document.documentElement.classList.contains("dark"); document.documentElement.classList.toggle("dark", n); localStorage.setItem(STORAGE_KEY_DARK_MODE, n ? "true" : "false"); };
  const onWizardDone = async () => { setShowWizard(false); try { const d = (await R("/api/config")) as ConfigApiResponse; setPl(coerce(d.payload)); setMeta({ configPath: d.meta.configPath }); await Promise.all([refreshSvc(), refreshH()]); } catch {} };

  return (
    <div style={{ minHeight: "100vh", background: "var(--c-bg)" }}>
      <Header lang={lang} toggleLang={toggleLang} toggleDark={toggleDark} serviceStatus={svc} busy={busy} onValidate={() => void onValidate()} onSave={() => void onSave()} onToggleService={() => void onToggle()} t={t} />

      <div className="content">
        {msg.text && <div className={`flash msg ${msg.type === "success" ? "msg-ok" : "msg-err"}`}>{msg.text}</div>}

        {showWizard ? (
          <SetupWizard request={R} t={t} html={html} onComplete={() => void onWizardDone()} initialPayload={pl} />
        ) : (
          <>
            <OverviewStats health={health} serviceStatus={svc} t={t} />

            <section className="section">
              <div className="section-head">
                <div><h2 className="section-title">{t("platformsTitle")}</h2><p className="section-desc">{t("platformsHint")}</p></div>
              </div>
              <div className="platform-grid">
                {PLATFORM_DEFINITIONS.map((def) => {
                  const pk = def.key as PlatformKey;
                  return <PlatformCard key={pk} def={def} values={pl.platforms[pk]} t={t} html={html} disabledVisual={!pl.platforms[pk].enabled} onChange={(p) => upP(pk, p)} onTest={() => void onTest(pk)} testing={tBusy === pk} testResult={tMsg[pk]} />;
                })}
              </div>
            </section>

            <AiConfigSection ai={pl.ai} onUpdate={upA} t={t} html={html} />

            <ConfigFilesSection configJson={cfgJ} setConfigJson={setCfgJ} claudeSettingsJson={claudeJ} setClaudeSettingsJson={setClaudeJ} codexSettingsJson={codexJ} setCodexSettingsJson={setCodexJ} jsonValidation={jv} onSaveConfig={saveCfg} onSaveClaude={saveClaude} onSaveCodex={saveCodex} onFormat={fmtJson} onReset={resetJson} meta={meta} setMessage={setMsg} t={t} />
          </>
        )}
      </div>
    </div>
  );
}
