import { useCallback, useEffect, useRef, useState } from "react";
import {
  PLATFORM_DEFINITIONS,
  PLATFORM_KEYS,
  POLLING_INTERVAL_MS,
  STORAGE_KEY_DARK_MODE,
  STORAGE_KEY_LANG,
} from "./constants.js";
import { useI18n, type Lang } from "./hooks/useI18n.js";
import type { AiCommand, ConfigApiResponse, PlatformKey, WebConfigPayload } from "./types.js";
import { useApi } from "./context/ApiContext.js";

import { Sidebar } from "./components/Sidebar.js";
import { Header } from "./components/Header.js";
import { OverviewStats } from "./components/OverviewStats.js";
import { PlatformCard } from "./components/PlatformCard.js";
import { AiConfigSection } from "./components/AiConfigSection.js";
import { ConfigFilesSection } from "./components/ConfigFilesSection.js";
import { SetupWizard } from "./components/SetupWizard.js";

/* ---------- helpers ---------- */

function toErrorMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function prettyJson(raw: string): string {
  return JSON.stringify(JSON.parse(raw), null, 2) + "\n";
}

function normalizeWebAiCommand(v: unknown): AiCommand {
  return v === "codex" || v === "codebuddy" || v === "claude" || v === "" ? (v as AiCommand) : "claude";
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

function coercePayload(raw: WebConfigPayload): WebConfigPayload {
  const base = emptyPayload();
  const mergePlatform = <K extends PlatformKey>(k: K) => {
    const m = { ...base.platforms[k], ...raw.platforms[k] };
    return { ...m, aiCommand: normalizeWebAiCommand(m.aiCommand) };
  };
  return {
    platforms: {
      telegram: mergePlatform("telegram"),
      feishu: mergePlatform("feishu"),
      qq: mergePlatform("qq"),
      wework: mergePlatform("wework"),
      dingtalk: mergePlatform("dingtalk"),
      workbuddy: mergePlatform("workbuddy"),
      clawbot: mergePlatform("clawbot"),
    },
    ai: {
      ...base.ai,
      ...raw.ai,
      hookPort: typeof raw.ai.hookPort === "number" ? raw.ai.hookPort : Number(raw.ai.hookPort) || 0,
    },
  };
}

/* ---------- Dashboard ---------- */

export function Dashboard() {
  const request = useApi();

  /* i18n */
  const [lang, setLang] = useState<Lang>(() => {
    const s = localStorage.getItem(STORAGE_KEY_LANG) || "";
    return s.startsWith("zh") || (typeof navigator !== "undefined" && navigator.language.startsWith("zh")) ? "zh" : "en";
  });
  const { t, html } = useI18n(lang);

  /* state */
  const [payload, setPayload] = useState<WebConfigPayload>(emptyPayload);
  const [meta, setMeta] = useState<{ configPath: string }>({ configPath: "" });
  const [claudeSettingsJson, setClaudeSettingsJson] = useState("");
  const [codexSettingsJson, setCodexSettingsJson] = useState("");
  const [configJson, setConfigJson] = useState("");
  const [originalConfigJson, setOriginalConfigJson] = useState("");
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" | "" }>({ text: "", type: "" });
  const [busy, setBusy] = useState(false);
  const [activeNav, setActiveNav] = useState<string>("overview");
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [serviceStatus, setServiceStatus] = useState<{ running: boolean; pid?: number }>({ running: false });
  const [jsonValidation, setJsonValidation] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [testBusy, setTestBusy] = useState<PlatformKey | null>(null);
  const [testMsg, setTestMsg] = useState<Partial<Record<PlatformKey, { text: string; ok: boolean }>>>({});

  /* refs */
  const refOverview = useRef<HTMLElement>(null);
  const refPlatforms = useRef<HTMLElement>(null);
  const refAi = useRef<HTMLElement>(null);
  const refFiles = useRef<HTMLElement>(null);

  /* ---------- data loading ---------- */
  const refreshStatus = useCallback(async () => {
    const data = (await request("/api/service/status")) as { running?: boolean; pid?: number };
    const next = { running: Boolean(data.running), pid: data.pid };
    setServiceStatus(prev => (prev.running === next.running && prev.pid === next.pid ? prev : next));
    return data;
  }, [request]);

  const refreshHealth = useCallback(async () => {
    try {
      const data = (await request("/api/health")) as Record<string, unknown>;
      setHealth(prev => (prev && JSON.stringify(prev) === JSON.stringify(data) ? prev : data));
    } catch { /* ignore */ }
  }, [request]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBusy(true);
      setMessage({ text: "", type: "" });
      try {
        const data = (await request("/api/config")) as ConfigApiResponse;
        if (cancelled) return;
        const coerced = coercePayload(data.payload);
        setPayload(coerced);
        setMeta({ configPath: data.meta.configPath });

        const [claude, codex, file] = await Promise.all([
          request("/api/claude/settings") as Promise<{ contents?: string }>,
          request("/api/codex/settings") as Promise<{ contents?: string }>,
          request("/api/config/file") as Promise<{ contents?: string }>,
          refreshStatus(),
          refreshHealth(),
        ]);
        if (cancelled) return;

        const fmt = (raw: string | undefined, fallback: string) => {
          const s = (raw ?? "").trim();
          if (!s) return fallback;
          try { return prettyJson(s); } catch { return s; }
        };
        setClaudeSettingsJson(fmt(claude.contents, "{\n}\n"));
        setCodexSettingsJson(fmt(codex.contents, "{\n}\n"));
        const rawJ = (file.contents ?? "").trim();
        setOriginalConfigJson(rawJ);
        setConfigJson(fmt(file.contents, "{}\n"));
      } catch (e) {
        if (!cancelled) setMessage({ text: toErrorMsg(e), type: "error" });
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [request, refreshHealth, refreshStatus]);

  /* poll */
  useEffect(() => {
    const id = window.setInterval(() => {
      void refreshStatus().catch(() => {});
      void refreshHealth().catch(() => {});
    }, POLLING_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refreshHealth, refreshStatus]);

  /* ---------- json validation ---------- */
  const validateJsonEditor = useCallback(() => {
    try {
      JSON.parse(configJson);
      setJsonValidation({ text: t("jsonValid"), type: "success" });
    } catch (err) {
      setJsonValidation({ text: t("jsonInvalid", { error: err instanceof Error ? err.message : String(err) }), type: "error" });
    }
  }, [configJson, t]);

  useEffect(() => { validateJsonEditor(); }, [configJson, validateJsonEditor]);

  /* ---------- save/start/stop ---------- */
  const buildPayload = useCallback((): WebConfigPayload => ({
    ...payload,
    ai: { ...payload.ai, hookPort: Number(payload.ai.hookPort) || 0 },
  }), [payload]);

  const collectClientErrors = useCallback((): string[] => {
    const errors: string[] = [];
    if (!PLATFORM_KEYS.some(k => payload.platforms[k].enabled)) errors.push(t("validationNoPlatformEnabled"));
    PLATFORM_DEFINITIONS.forEach((def) => {
      if (!payload.platforms[def.key as PlatformKey].enabled) return;
      const missing = def.requiredFields.filter(
        f => !String((payload.platforms[def.key as PlatformKey] as Record<string, unknown>)[f] ?? "").trim()
      );
      if (missing.length) errors.push(t("validationPlatformIncomplete", { platform: def.label, fields: missing.join(", ") }));
    });
    const anyCodex = PLATFORM_KEYS.some(k => payload.platforms[k].enabled && payload.platforms[k].aiCommand === "codex");
    const anyCodebuddy = PLATFORM_KEYS.some(k => payload.platforms[k].enabled && payload.platforms[k].aiCommand === "codebuddy");
    if (anyCodex && !payload.ai.codexCliPath.trim()) errors.push(t("validationAiCodexNoCli"));
    if (anyCodebuddy && !payload.ai.codebuddyCliPath.trim()) errors.push(t("validationAiCodebuddyNoCli"));
    return errors;
  }, [payload, t]);

  const onValidate = async () => {
    const err = collectClientErrors();
    if (err.length) { setMessage({ text: err.join(" "), type: "error" }); return; }
    setBusy(true);
    try {
      await request("/api/config/validate", { method: "POST", body: JSON.stringify(buildPayload()) });
      setMessage({ text: t("validationOk"), type: "success" });
    } catch (e) { setMessage({ text: toErrorMsg(e), type: "error" }); } finally { setBusy(false); }
  };

  const saveClaudeSettings = async () => {
    await request("/api/claude/settings", { method: "POST", body: JSON.stringify({ contents: claudeSettingsJson }) });
  };
  const saveCodexSettings = async () => {
    await request("/api/codex/settings", { method: "POST", body: JSON.stringify({ contents: codexSettingsJson }) });
  };
  const saveOpenImConfigFile = async () => {
    const json = configJson.trim();
    if (!json) return;
    JSON.parse(json);
    await request("/api/config/file", { method: "POST", body: JSON.stringify({ contents: json }) });
    setOriginalConfigJson(json);
  };

  const onSave = async () => {
    const err = collectClientErrors();
    if (err.length) { setMessage({ text: err.join(" "), type: "error" }); return; }
    setBusy(true);
    try {
      await Promise.all([saveClaudeSettings(), saveCodexSettings(), saveOpenImConfigFile()]);
      await request("/api/config/save?final=1", { method: "POST", body: JSON.stringify(buildPayload()) });
      setMessage({ text: t("saveOk"), type: "success" });
    } catch (e) { setMessage({ text: toErrorMsg(e), type: "error" }); } finally { setBusy(false); }
  };

  const onStart = async () => {
    const err = collectClientErrors();
    if (err.length) { setMessage({ text: err.join(" "), type: "error" }); return; }
    setBusy(true);
    try {
      await Promise.all([
        saveClaudeSettings(),
        saveCodexSettings(),
        request("/api/config/save", { method: "POST", body: JSON.stringify(buildPayload()) }),
      ]);
      await request("/api/service/start", { method: "POST" });
      await Promise.all([refreshStatus(), refreshHealth()]);
      setMessage({ text: t("startOk"), type: "success" });
    } catch (e) { setMessage({ text: toErrorMsg(e), type: "error" }); } finally { setBusy(false); }
  };

  const onStop = async () => {
    setBusy(true);
    try {
      await request("/api/service/stop", { method: "POST" });
      await refreshStatus();
      setMessage({ text: t("stopOk"), type: "success" });
    } catch (e) { setMessage({ text: toErrorMsg(e), type: "error" }); } finally { setBusy(false); }
  };

  const onToggleService = async () => {
    if (serviceStatus.running) await onStop(); else await onStart();
  };

  /* ---------- platform test ---------- */
  const onTestPlatform = async (key: PlatformKey) => {
    const def = PLATFORM_DEFINITIONS.find(d => d.key === key);
    if (!def) return;
    setTestBusy(key);
    setTestMsg(m => ({ ...m, [key]: { text: "", ok: true } }));
    try {
      const cfg: Record<string, string> = {};
      def.testFields.forEach(f => { cfg[f] = String((payload.platforms[key] as Record<string, string>)[f] ?? ""); });
      const result = (await request("/api/config/test", {
        method: "POST",
        body: JSON.stringify({ platform: key, config: cfg }),
      })) as { success?: boolean; message?: string; error?: string };
      setTestMsg(m => ({
        ...m,
        [key]: result.success
          ? { text: result.message || t("testSuccess"), ok: true }
          : { text: t("testFailed", { error: result.error || "?" }), ok: false },
      }));
    } catch (e) {
      setTestMsg(m => ({ ...m, [key]: { text: t("testFailed", { error: toErrorMsg(e) }), ok: false } }));
    } finally { setTestBusy(null); }
  };

  /* ---------- platform update ---------- */
  const updatePlatform = <K extends PlatformKey>(key: K, patch: Partial<WebConfigPayload["platforms"][K]>) => {
    setPayload(p => ({
      ...p,
      platforms: { ...p.platforms, [key]: { ...p.platforms[key], ...patch } },
    }));
  };
  const updateAi = (patch: Partial<WebConfigPayload["ai"]>) => {
    setPayload(p => ({ ...p, ai: { ...p.ai, ...patch } }));
  };

  /* ---------- navigation ---------- */
  const scrollTo = (id: string) => {
    setActiveNav(id);
    const map: Record<string, React.RefObject<HTMLElement | null>> = {
      overview: refOverview, platforms: refPlatforms, ai: refAi, files: refFiles,
    };
    map[id]?.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  /* ---------- format / reset ---------- */
  const formatJson = () => {
    try { setConfigJson(prettyJson(configJson)); }
    catch { setJsonValidation({ text: t("jsonInvalid", { error: "parse" }), type: "error" }); }
  };
  const resetJson = () => setConfigJson(originalConfigJson ? `${originalConfigJson}\n` : "{}\n");

  /* ---------- dark mode / lang ---------- */
  const toggleLang = () => {
    const next: Lang = lang === "zh" ? "en" : "zh";
    setLang(next);
    localStorage.setItem(STORAGE_KEY_LANG, next);
  };
  const toggleDark = () => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem(STORAGE_KEY_DARK_MODE, next ? "true" : "false");
  };

  /* ---------- wizard callback ---------- */
  const onWizardComplete = async () => {
    setActiveNav("overview");
    // re-fetch fresh state after wizard saved + started
    try {
      const data = (await request("/api/config")) as ConfigApiResponse;
      const coerced = coercePayload(data.payload);
      setPayload(coerced);
      setMeta({ configPath: data.meta.configPath });
      await Promise.all([refreshStatus(), refreshHealth()]);
    } catch { /* ignore */ }
  };

  /* ---------- render ---------- */
  return (
    <div className="app">
      <Sidebar activeNav={activeNav} onNavigate={scrollTo} t={t} />

      <main className="main">
        <Header
          lang={lang}
          toggleLang={toggleLang}
          toggleDark={toggleDark}
          serviceStatus={serviceStatus}
          busy={busy}
          onValidate={() => void onValidate()}
          onSave={() => void onSave()}
          onToggleService={() => void onToggleService()}
          t={t}
        />

        <div className="content">
          {message.text ? (
            <div className={`message ${message.type === "success" ? "message-success" : message.type === "error" ? "message-error" : ""}`} style={{ marginBottom: 16 }}>
              {message.text}
            </div>
          ) : null}

          {activeNav === "wizard" ? (
            <section className="section">
              <SetupWizard
                request={request}
                t={t}
                html={html}
                onComplete={() => void onWizardComplete()}
                initialPayload={payload}
              />
            </section>
          ) : (
            <>
              <OverviewStats health={health} serviceStatus={serviceStatus} t={t} />

              <section className="section" ref={refPlatforms as React.RefObject<HTMLElement>}>
                <div className="section-header">
                  <h2 className="section-title">{t("platformsTitle")}</h2>
                  <p className="section-description">{t("platformsHint")}</p>
                </div>
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
                        onChange={(patch) => updatePlatform(pk, patch)}
                        onTest={() => void onTestPlatform(pk)}
                        testing={testBusy === pk}
                        testResult={testMsg[pk]}
                      />
                    );
                  })}
                </div>
              </section>

              <AiConfigSection ai={payload.ai} onUpdate={updateAi} t={t} html={html} forwardRef={refAi} />

              <ConfigFilesSection
                configJson={configJson}
                setConfigJson={setConfigJson}
                originalConfigJson={originalConfigJson}
                claudeSettingsJson={claudeSettingsJson}
                setClaudeSettingsJson={setClaudeSettingsJson}
                codexSettingsJson={codexSettingsJson}
                setCodexSettingsJson={setCodexSettingsJson}
                jsonValidation={jsonValidation}
                onSaveConfig={saveOpenImConfigFile}
                onSaveClaude={saveClaudeSettings}
                onSaveCodex={saveCodexSettings}
                onFormat={formatJson}
                onReset={resetJson}
                meta={meta}
                setMessage={setMessage}
                t={t}
                forwardRef={refFiles}
              />
            </>
          )}
        </div>
      </main>
    </div>
  );
}
