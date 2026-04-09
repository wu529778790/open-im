import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  PLATFORM_DEFINITIONS,
  PLATFORM_KEYS,
  POLLING_INTERVAL_MS,
  STORAGE_KEY_DARK_MODE,
  STORAGE_KEY_LANG,
} from "./constants.js";
import { INLINE_TIP_KEY, PLATFORM_FIELD_LABEL, PLATFORM_HELP_KEY, PLATFORM_SUMMARY_KEY } from "./fieldLabels.js";
import { useI18n, type Lang } from "./hooks/useI18n.js";
import type { AiCommand, ConfigApiResponse, PlatformKey, WebConfigPayload } from "./types.js";
import { useApi } from "./context/ApiContext.js";

function toErrorMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function prettyJson(raw: string): string {
  return JSON.stringify(JSON.parse(raw), null, 2) + "\n";
}

/** 与运行时 normalizeAiCommand 一致，避免非法/大小写错误的字符串导致 <select> 无法匹配选项 */
function normalizeWebAiCommand(v: unknown): AiCommand {
  return v === "codex" || v === "codebuddy" || v === "claude" || v === "" ? (v as AiCommand) : "claude";
}

function pickInitialAiPanel(platforms: WebConfigPayload["platforms"]): "claude" | "codex" | "codebuddy" {
  for (const k of PLATFORM_KEYS) {
    if (!platforms[k].enabled) continue;
    const c = platforms[k].aiCommand;
    if (c === "codex" || c === "codebuddy" || c === "claude") return c;
  }
  return "claude";
}

function emptyPayload(): WebConfigPayload {
  return {
    platforms: {
      telegram: {
        enabled: false,
        aiCommand: "claude",
        botToken: "",
        proxy: "",
        allowedUserIds: "",
      },
      feishu: {
        enabled: false,
        aiCommand: "claude",
        appId: "",
        appSecret: "",
        allowedUserIds: "",
      },
      qq: {
        enabled: false,
        aiCommand: "claude",
        appId: "",
        secret: "",
        allowedUserIds: "",
      },
      wework: {
        enabled: false,
        aiCommand: "claude",
        corpId: "",
        secret: "",
        allowedUserIds: "",
      },
      dingtalk: {
        enabled: false,
        aiCommand: "claude",
        clientId: "",
        clientSecret: "",
        cardTemplateId: "",
        allowedUserIds: "",
      },
      workbuddy: {
        enabled: false,
        aiCommand: "claude",
        accessToken: "",
        refreshToken: "",
        userId: "",
        baseUrl: "",
        allowedUserIds: "",
      },
    },
    ai: {
      claudeWorkDir: "",
      claudeConfigPath: "",
      claudeProxy: "",
      codexCliPath: "codex",
      codexProxy: "",
      codebuddyCliPath: "codebuddy",
      hookPort: 0,
      logLevel: "default",
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
    },
    ai: {
      ...base.ai,
      ...raw.ai,
      hookPort:
        typeof raw.ai.hookPort === "number"
          ? raw.ai.hookPort
          : Number(raw.ai.hookPort) || 0,
    },
  };
}

export function Dashboard() {
  const request = useApi();
  const [lang, setLang] = useState<Lang>(() => {
    const s = localStorage.getItem(STORAGE_KEY_LANG) || "";
    return s.startsWith("zh") || (typeof navigator !== "undefined" && navigator.language.startsWith("zh"))
      ? "zh"
      : "en";
  });
  const { t, html } = useI18n(lang);

  const [payload, setPayload] = useState<WebConfigPayload>(emptyPayload);
  const [meta, setMeta] = useState<{ configPath: string }>({ configPath: "" });
  const [claudeSettingsJson, setClaudeSettingsJson] = useState("");
  const [codexSettingsJson, setCodexSettingsJson] = useState("");
  const [configJson, setConfigJson] = useState("");
  const [originalConfigJson, setOriginalConfigJson] = useState("");
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" | "" }>({ text: "", type: "" });
  const [busy, setBusy] = useState(false);
  const [activeNav, setActiveNav] = useState("overview");
  const [currentAiPanel, setCurrentAiPanel] = useState<"claude" | "codex" | "codebuddy">("claude");
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [serviceStatus, setServiceStatus] = useState<{ running: boolean; pid?: number }>({ running: false });
  const [jsonValidation, setJsonValidation] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [testBusy, setTestBusy] = useState<PlatformKey | null>(null);
  const [testMsg, setTestMsg] = useState<Partial<Record<PlatformKey, { text: string; ok: boolean }>>>({});

  const refDashboard = useRef<HTMLElement>(null);
  const refPlatforms = useRef<HTMLElement>(null);
  const refAi = useRef<HTMLElement>(null);
  const refFiles = useRef<HTMLElement>(null);

  const buildPayload = useCallback((): WebConfigPayload => {
    return {
      platforms: payload.platforms,
      ai: {
        ...payload.ai,
        hookPort: Number(payload.ai.hookPort) || 0,
      },
    };
  }, [payload]);

  const collectClientErrors = useCallback((): string[] => {
    const errors: string[] = [];
    const anyEnabled = PLATFORM_KEYS.some((k) => payload.platforms[k].enabled);
    if (!anyEnabled) errors.push(t("validationNoPlatformEnabled"));
    PLATFORM_DEFINITIONS.forEach((def) => {
      if (!payload.platforms[def.key].enabled) return;
      const missing = def.requiredFields.filter((f) => !String((payload.platforms[def.key] as Record<string, unknown>)[f] ?? "").trim());
      if (missing.length)
        errors.push(t("validationPlatformIncomplete", { platform: def.label, fields: missing.join(", ") }));
    });
    const anyCodex = PLATFORM_KEYS.some(
      (k) => payload.platforms[k].enabled && payload.platforms[k].aiCommand === "codex",
    );
    const anyCodebuddy = PLATFORM_KEYS.some(
      (k) => payload.platforms[k].enabled && payload.platforms[k].aiCommand === "codebuddy",
    );
    if (anyCodex && !payload.ai.codexCliPath.trim()) errors.push(t("validationAiCodexNoCli"));
    if (anyCodebuddy && !payload.ai.codebuddyCliPath.trim()) errors.push(t("validationAiCodebuddyNoCli"));
    return errors;
  }, [payload, t]);

  const refreshStatus = useCallback(async () => {
    const data = (await request("/api/service/status")) as { running?: boolean; pid?: number };
    const next = { running: Boolean(data.running), pid: data.pid };
    setServiceStatus((prev) => (prev.running === next.running && prev.pid === next.pid ? prev : next));
    return data;
  }, [request]);

  const refreshHealth = useCallback(async () => {
    try {
      const data = (await request("/api/health")) as Record<string, unknown>;
      setHealth((prev) => {
        if (prev && JSON.stringify(prev) === JSON.stringify(data)) return prev;
        return data;
      });
    } catch {
      /* ignore */
    }
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
        setCurrentAiPanel(pickInitialAiPanel(coerced.platforms));
        setMeta({ configPath: data.meta.configPath });

        const [claude, codex, file, ,] = await Promise.all([
          request("/api/claude/settings") as Promise<{ contents?: string }>,
          request("/api/codex/settings") as Promise<{ contents?: string }>,
          request("/api/config/file") as Promise<{ contents?: string }>,
          refreshStatus(),
          refreshHealth(),
        ]);
        if (cancelled) return;

        const rawC = (claude.contents ?? "").trim();
        if (rawC) {
          try {
            setClaudeSettingsJson(prettyJson(rawC));
          } catch {
            setClaudeSettingsJson(rawC);
          }
        } else {
          setClaudeSettingsJson("{\n}\n");
        }

        const rawCodex = (codex.contents ?? "").trim();
        if (rawCodex) {
          try {
            setCodexSettingsJson(prettyJson(rawCodex));
          } catch {
            setCodexSettingsJson(rawCodex);
          }
        } else {
          setCodexSettingsJson("{\n}\n");
        }

        const rawJ = (file.contents ?? "").trim();
        setOriginalConfigJson(rawJ);
        if (rawJ) {
          try {
            setConfigJson(prettyJson(rawJ));
          } catch {
            setConfigJson(rawJ);
          }
        } else {
          setConfigJson("{}\n");
        }

      } catch (e) {
        if (!cancelled) setMessage({ text: toErrorMsg(e), type: "error" });
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [request, refreshHealth, refreshStatus]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void refreshStatus().catch(() => {});
      void refreshHealth().catch(() => {});
    }, POLLING_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refreshHealth, refreshStatus]);

  const validateJsonEditor = useCallback(() => {
    try {
      JSON.parse(configJson);
      setJsonValidation({ text: t("jsonValid"), type: "success" });
    } catch (err) {
      setJsonValidation({
        text: t("jsonInvalid", { error: err instanceof Error ? err.message : String(err) }),
        type: "error",
      });
    }
  }, [configJson, t]);

  useEffect(() => {
    validateJsonEditor();
  }, [configJson, validateJsonEditor]);

  const saveClaudeSettings = async () => {
    await request("/api/claude/settings", {
      method: "POST",
      body: JSON.stringify({ contents: claudeSettingsJson }),
    });
  };

  const saveCodexSettings = async () => {
    await request("/api/codex/settings", {
      method: "POST",
      body: JSON.stringify({ contents: codexSettingsJson }),
    });
  };

  const saveOpenImConfigFile = async () => {
    const json = configJson.trim();
    if (!json) return;
    JSON.parse(json);
    await request("/api/config/file", {
      method: "POST",
      body: JSON.stringify({ contents: json }),
    });
    setOriginalConfigJson(json);
  };

  const onValidate = async () => {
    const err = collectClientErrors();
    if (err.length) {
      setMessage({ text: err.join(" "), type: "error" });
      return;
    }
    setBusy(true);
    try {
      await request("/api/config/validate", {
        method: "POST",
        body: JSON.stringify(buildPayload()),
      });
      setMessage({ text: t("validationOk"), type: "success" });
    } catch (e) {
      setMessage({ text: toErrorMsg(e), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const onSave = async () => {
    const err = collectClientErrors();
    if (err.length) {
      setMessage({ text: err.join(" "), type: "error" });
      return;
    }
    setBusy(true);
    try {
      await Promise.all([saveClaudeSettings(), saveCodexSettings(), saveOpenImConfigFile()]);
      await request("/api/config/save?final=1", {
        method: "POST",
        body: JSON.stringify(buildPayload()),
      });
      setMessage({ text: t("saveOk"), type: "success" });
    } catch (e) {
      setMessage({ text: toErrorMsg(e), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const onStart = async () => {
    const err = collectClientErrors();
    if (err.length) {
      setMessage({ text: err.join(" "), type: "error" });
      return;
    }
    setBusy(true);
    try {
      await Promise.all([
        saveClaudeSettings(),
        saveCodexSettings(),
        request("/api/config/save", {
          method: "POST",
          body: JSON.stringify(buildPayload()),
        }),
      ]);
      await request("/api/service/start", { method: "POST" });
      await Promise.all([refreshStatus(), refreshHealth()]);
      setMessage({ text: t("startOk"), type: "success" });
    } catch (e) {
      setMessage({ text: toErrorMsg(e), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const onStop = async () => {
    setBusy(true);
    try {
      await request("/api/service/stop", { method: "POST" });
      await refreshStatus();
      setMessage({ text: t("stopOk"), type: "success" });
    } catch (e) {
      setMessage({ text: toErrorMsg(e), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const onToggleService = async () => {
    if (serviceStatus.running) await onStop();
    else await onStart();
  };

  const onTestPlatform = async (key: PlatformKey) => {
    const def = PLATFORM_DEFINITIONS.find((d) => d.key === key);
    if (!def) return;
    setTestBusy(key);
    setTestMsg((m) => ({ ...m, [key]: { text: "", ok: true } }));
    try {
      const cfg: Record<string, string> = {};
      def.testFields.forEach((f) => {
        cfg[f] = String((payload.platforms[key] as Record<string, string>)[f] ?? "");
      });
      const result = (await request("/api/config/test", {
        method: "POST",
        body: JSON.stringify({ platform: key, config: cfg }),
      })) as { success?: boolean; message?: string; error?: string };
      if (result.success) {
        setTestMsg((m) => ({
          ...m,
          [key]: { text: result.message || t("testSuccess"), ok: true },
        }));
      } else {
        setTestMsg((m) => ({
          ...m,
          [key]: { text: t("testFailed", { error: result.error || "?" }), ok: false },
        }));
      }
    } catch (e) {
      setTestMsg((m) => ({
        ...m,
        [key]: { text: t("testFailed", { error: toErrorMsg(e) }), ok: false },
      }));
    } finally {
      setTestBusy(null);
    }
  };

  const scrollTo = (id: "overview" | "platforms" | "ai" | "files") => {
    setActiveNav(id);
    const map = {
      overview: refDashboard,
      platforms: refPlatforms,
      ai: refAi,
      files: refFiles,
    } as const;
    map[id].current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const stats = useMemo(() => {
    const platforms = (health?.platforms ?? {}) as Record<string, { configured?: boolean; enabled?: boolean }>;
    let configured = 0;
    let enabled = 0;
    PLATFORM_KEYS.forEach((k) => {
      const p = platforms[k];
      if (p?.configured) configured += 1;
      if (p?.enabled) enabled += 1;
    });
    return { configured, enabled, total: PLATFORM_KEYS.length };
  }, [health]);

  const updatePlatform = <K extends PlatformKey>(key: K, patch: Partial<WebConfigPayload["platforms"][K]>) => {
    setPayload((p) => ({
      ...p,
      platforms: { ...p.platforms, [key]: { ...p.platforms[key], ...patch } },
    }));
    const cmd = patch.aiCommand;
    if (cmd === "claude" || cmd === "codex" || cmd === "codebuddy") {
      setCurrentAiPanel(cmd);
    }
  };

  const updateAi = (patch: Partial<WebConfigPayload["ai"]>) => {
    setPayload((p) => ({ ...p, ai: { ...p.ai, ...patch } }));
  };

  const formatJson = () => {
    try {
      setConfigJson(prettyJson(configJson));
    } catch {
      setJsonValidation({ text: t("jsonInvalid", { error: "parse" }), type: "error" });
    }
  };

  const resetJson = () => setConfigJson(originalConfigJson ? `${originalConfigJson}\n` : "{}\n");

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

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
            open-im
          </div>
        </div>
        <nav className="sidebar-nav">
          <button type="button" className={`nav-item ${activeNav === "overview" ? "active" : ""}`} onClick={() => scrollTo("overview")}>
            <NavIconOverview />
            <span>{t("dashboardTitle")}</span>
          </button>
          <button type="button" className={`nav-item ${activeNav === "platforms" ? "active" : ""}`} onClick={() => scrollTo("platforms")}>
            <NavIconPlatforms />
            <span>{t("platformsTitle")}</span>
          </button>
          <button type="button" className={`nav-item ${activeNav === "files" ? "active" : ""}`} onClick={() => scrollTo("files")}>
            <NavIconFiles />
            <span>{t("navConfigFiles")}</span>
          </button>
          <button type="button" className={`nav-item ${activeNav === "ai" ? "active" : ""}`} onClick={() => scrollTo("ai")}>
            <NavIconAi />
            <span>{t("aiTitle")}</span>
          </button>
        </nav>
      </aside>

      <main className="main">
        <header className="main-header">
          <div className="main-header-top">
            <div>
              <h1 className="main-title">{t("dashboardTitle")}</h1>
            </div>
            <div className="header-actions">
              <a href="https://github.com/wu529778790/open-im" target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
                GitHub
              </a>
              <button type="button" className="dark-mode-toggle" onClick={toggleDark} aria-label={t("darkModeToggle")}>
                ◐
              </button>
              <button type="button" className="lang-button" onClick={toggleLang}>
                {lang === "zh" ? "EN" : "中文"}
              </button>
            </div>
          </div>
          <div className="main-header-toolbar" role="toolbar" aria-label={t("headerToolbarAria")}>
            <button type="button" className="btn btn-warning btn-sm" disabled={busy} onClick={() => void onValidate()}>
              {t("validate")}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void onSave()}>
              {t("save")}
            </button>
            <button
              type="button"
              className={`btn btn-sm ${serviceStatus.running ? "btn-danger" : "btn-primary"}`}
              disabled={busy}
              onClick={() => void onToggleService()}
            >
              {serviceStatus.running ? t("stop") : t("start")}
            </button>
          </div>
        </header>

        <div className="content">
          {message.text ? (
            <div
              className={`message ${message.type === "success" ? "message-success" : message.type === "error" ? "message-error" : ""}`}
              style={{ marginBottom: 16 }}
            >
              {message.text}
            </div>
          ) : null}

          <section className="section" ref={refDashboard as React.RefObject<HTMLElement>}>
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-label">{t("statConfiguredLabel")}</div>
                <div className="stat-value">
                  {stats.configured}/{stats.total}
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-label">{t("statEnabledLabel")}</div>
                <div className="stat-value">{stats.enabled}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">{t("statServiceLabel")}</div>
                <div className="stat-value">{serviceStatus.running ? t("serviceRunningShort") : t("serviceIdleShort")}</div>
              </div>
            </div>
          </section>

          <section className="section" ref={refPlatforms as React.RefObject<HTMLElement>}>
            <div className="section-header">
              <h2 className="section-title">{t("platformsTitle")}</h2>
              <p className="section-description">{t("platformsHint")}</p>
            </div>
            <div className="platform-grid">
              {PLATFORM_DEFINITIONS.map((def) => (
                <PlatformCard
                  key={def.key}
                  def={def}
                  values={payload.platforms[def.key]}
                  t={t}
                  html={html}
                  disabledVisual={!payload.platforms[def.key].enabled}
                  onChange={(patch) => updatePlatform(def.key, patch)}
                  onTest={() => void onTestPlatform(def.key)}
                  testing={testBusy === def.key}
                  testResult={testMsg[def.key]}
                />
              ))}
            </div>
          </section>

          <section className="section" ref={refAi as React.RefObject<HTMLElement>}>
            <div className="section-header">
              <h2 className="section-title">{t("aiTitle")}</h2>
              <p className="section-description">{t("aiHint")}</p>
            </div>
            <div className="ai-grid">
              <div className="ai-card">
                <div className="card-header">
                  <h3 className="card-title">{t("aiCommonTitle")}</h3>
                </div>
                <div className="ai-card-body">
                  <p className="form-hint" style={{ marginBottom: 12 }}>
                    {t("aiPerPlatformHint")}
                  </p>
                  <div className="form-group">
                    <label className="form-label">{t("workDir")}</label>
                    <input
                      className="form-input mono"
                      value={payload.ai.claudeWorkDir}
                      onChange={(e) => updateAi({ claudeWorkDir: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">{t("hookPort")}</label>
                    <input
                      type="number"
                      min={1}
                      className="form-input"
                      value={payload.ai.hookPort || ""}
                      onChange={(e) => updateAi({ hookPort: Number(e.target.value) || 0 })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">{t("logLevel")}</label>
                    <select
                      className="form-select"
                      value={payload.ai.logLevel}
                      onChange={(e) => updateAi({ logLevel: e.target.value })}
                    >
                      <option value="default">{t("logLevelDefault")}</option>
                      <option value="DEBUG">DEBUG</option>
                      <option value="INFO">INFO</option>
                      <option value="WARN">WARN</option>
                      <option value="ERROR">ERROR</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="ai-card">
                <div className="card-header">
                  <div className="tabs">
                    {(["claude", "codex", "codebuddy"] as const).map((tool) => (
                      <button
                        key={tool}
                        type="button"
                        className={`tab ${currentAiPanel === tool ? "active" : ""}`}
                        onClick={() => setCurrentAiPanel(tool)}
                      >
                        {tool}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="ai-card-body">
                  <div className={`ai-tool-panel ${currentAiPanel === "claude" ? "active" : ""}`}>
                    <div className="form-group">
                      <label className="form-label">{t("claudeProxy")}</label>
                      <input
                        className="form-input mono"
                        value={payload.ai.claudeProxy}
                        onChange={(e) => updateAi({ claudeProxy: e.target.value })}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{t("claudeConfigPath")}</label>
                      <input className="form-input mono" readOnly style={{ background: "var(--bg-secondary)" }} value={payload.ai.claudeConfigPath} />
                    </div>
                  </div>
                  <div className={`ai-tool-panel ${currentAiPanel === "codex" ? "active" : ""}`}>
                    <div className="form-group">
                      <label className="form-label">{t("codexApiKey")}</label>
                      <input
                        className="form-input mono"
                        type="password"
                        value={payload.ai.codexApiKey ?? ""}
                        onChange={(e) => updateAi({ codexApiKey: e.target.value })}
                      />
                      <p className="field-inline-tip" dangerouslySetInnerHTML={{ __html: t("codexApiKeyTip") }} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{t("codexCli")}</label>
                      <input
                        className="form-input mono"
                        value={payload.ai.codexCliPath}
                        onChange={(e) => updateAi({ codexCliPath: e.target.value })}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{t("codexProxy")}</label>
                      <input
                        className="form-input mono"
                        value={payload.ai.codexProxy}
                        onChange={(e) => updateAi({ codexProxy: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className={`ai-tool-panel ${currentAiPanel === "codebuddy" ? "active" : ""}`}>
                    <div className="form-group">
                      <label className="form-label">{t("codebuddyCli")}</label>
                      <input
                        className="form-input mono"
                        value={payload.ai.codebuddyCliPath}
                        onChange={(e) => updateAi({ codebuddyCliPath: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="section" ref={refFiles as React.RefObject<HTMLElement>}>
            <div className="section-header">
              <h2 className="section-title">{t("configFilesTitle")}</h2>
              <p className="section-description">{t("configFilesHint")}</p>
            </div>
            <div className="config-files-stack">
              <div className="card config-file-card">
                <div className="card-header">
                  <h3 className="card-title mono">{t("configJson")}</h3>
                </div>
                <div className="card-body">
                  <p className="form-hint">{t("openImConfigCardHint")}</p>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 8 }}>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={formatJson}>
                      {t("formatJson")}
                    </button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={resetJson}>
                      {t("resetJson")}
                    </button>
                  </div>
                  <textarea
                    className="form-input mono"
                    rows={18}
                    spellCheck={false}
                    value={configJson}
                    onChange={(e) => setConfigJson(e.target.value)}
                    style={{ minHeight: 360, resize: "vertical", whiteSpace: "pre" }}
                  />
                  {jsonValidation ? (
                    <div className={`message mt-4 ${jsonValidation.type === "success" ? "message-success" : "message-error"}`}>{jsonValidation.text}</div>
                  ) : null}
                  <div style={{ marginTop: 10 }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() =>
                        void (async () => {
                          try {
                            await saveOpenImConfigFile();
                            setMessage({ text: t("saveOk"), type: "success" });
                          } catch (e) {
                            setMessage({ text: toErrorMsg(e), type: "error" });
                          }
                        })()
                      }
                    >
                      {t("saveBtn")}
                    </button>
                  </div>
                </div>
              </div>
              <div className="card config-file-card">
                <div className="card-header">
                  <h3 className="card-title mono">{t("claudeSettingsLabel")}</h3>
                </div>
                <div className="card-body">
                  <p className="form-hint">{t("claudeSettingsCardHint")}</p>
                  <textarea
                    className="form-input mono"
                    rows={12}
                    spellCheck={false}
                    value={claudeSettingsJson}
                    onChange={(e) => setClaudeSettingsJson(e.target.value)}
                    style={{ minHeight: 220, resize: "vertical", whiteSpace: "pre" }}
                  />
                  <div style={{ marginTop: 10 }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() =>
                        void (async () => {
                          try {
                            await saveClaudeSettings();
                            setMessage({ text: t("saveOk"), type: "success" });
                          } catch (e) {
                            setMessage({ text: toErrorMsg(e), type: "error" });
                          }
                        })()
                      }
                    >
                      {t("saveBtn")}
                    </button>
                  </div>
                </div>
              </div>
              <div className="card config-file-card">
                <div className="card-header">
                  <h3 className="card-title mono">{t("codexSettingsLabel")}</h3>
                </div>
                <div className="card-body">
                  <p className="form-hint">{t("codexSettingsCardHint")}</p>
                  <textarea
                    className="form-input mono"
                    rows={8}
                    spellCheck={false}
                    value={codexSettingsJson}
                    onChange={(e) => setCodexSettingsJson(e.target.value)}
                    style={{ minHeight: 160, resize: "vertical", whiteSpace: "pre" }}
                  />
                  <div style={{ marginTop: 10 }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() =>
                        void (async () => {
                          try {
                            await saveCodexSettings();
                            setMessage({ text: t("saveOk"), type: "success" });
                          } catch (e) {
                            setMessage({ text: toErrorMsg(e), type: "error" });
                          }
                        })()
                      }
                    >
                      {t("saveBtn")}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <p className="form-hint" style={{ marginTop: 24 }}>
            {meta.configPath ? `${t("configJson")}: ${meta.configPath}` : ""}
          </p>
        </div>
      </main>
    </div>
  );
}

function PlatformCard({
  def,
  values,
  t,
  html,
  disabledVisual,
  onChange,
  onTest,
  testing,
  testResult,
}: {
  def: (typeof PLATFORM_DEFINITIONS)[number];
  values: WebConfigPayload["platforms"][typeof def.key];
  t: (k: string, p?: Record<string, string | number>) => string;
  html: (k: string) => string;
  disabledVisual: boolean;
  onChange: (patch: Partial<WebConfigPayload["platforms"][typeof def.key]>) => void;
  onTest: () => void;
  testing: boolean;
  testResult?: { text: string; ok: boolean };
}) {
  const summaryKey = PLATFORM_SUMMARY_KEY[def.key];
  const helpKey = PLATFORM_HELP_KEY[def.key];

  const fieldInput = (field: string): ReactNode => {
    const labelKey = PLATFORM_FIELD_LABEL[def.key][field as keyof (typeof PLATFORM_FIELD_LABEL)[typeof def.key]];
    const tipId = `${def.key}-${field}` as keyof typeof INLINE_TIP_KEY;
    const tipKey = INLINE_TIP_KEY[tipId];
    const isArea = field === "allowedUserIds";
    const isPassword = (def.sensitiveFields as readonly string[]).includes(field);

    return (
      <div className="form-group" key={field}>
        <label className="form-label">{labelKey ? t(labelKey) : field}</label>
        {isArea ? (
          <textarea
            className="form-textarea mono"
            value={String((values as Record<string, string>)[field] ?? "")}
            onChange={(e) => onChange({ [field]: e.target.value } as Partial<typeof values>)}
          />
        ) : field === "aiCommand" ? (
          <select
            className="form-select"
            value={String((values as Record<string, string>)[field] || "claude")}
            onChange={(e) => onChange({ aiCommand: e.target.value as AiCommand })}
          >
            <option value="claude">claude</option>
            <option value="codex">codex</option>
            <option value="codebuddy">codebuddy</option>
          </select>
        ) : (
          <input
            className="form-input mono"
            type={isPassword ? "password" : "text"}
            value={String((values as Record<string, string>)[field] ?? "")}
            onChange={(e) => onChange({ [field]: e.target.value } as Partial<typeof values>)}
          />
        )}
        {field === "allowedUserIds" ? <div className="form-hint">{t("commaSeparatedIds")}</div> : null}
        {tipKey ? (
          <div className="field-inline-tip" dangerouslySetInnerHTML={{ __html: html(tipKey) }} />
        ) : null}
      </div>
    );
  };

  return (
    <div className={`platform-card ${disabledVisual ? "disabled" : ""}`}>
      <div className="platform-header">
        <h3 className="platform-title">{def.label}</h3>
        <label className="toggle">
          <input
            type="checkbox"
            className="toggle-input"
            checked={values.enabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
          />
          <span className="toggle-switch" />
          <span className="toggle-label">{t("enabled")}</span>
        </label>
      </div>
      <div className="platform-body">
        <p className="form-hint">{t(summaryKey)}</p>
        {def.fields.map((f) => fieldInput(f))}
        <div className="form-help" dangerouslySetInnerHTML={{ __html: html(helpKey) }} />
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-secondary btn-sm" disabled={testing} onClick={onTest}>
            {testing ? t("testing") : t("test")}
          </button>
        </div>
        {testResult?.text ? (
          <div className={`message mt-4 ${testResult.ok ? "message-success" : "message-error"}`}>{testResult.text}</div>
        ) : null}
      </div>
    </div>
  );
}

function NavIconOverview() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  );
}
function NavIconPlatforms() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    </svg>
  );
}
function NavIconFiles() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}
function NavIconAi() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
      <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 14a4 4 0 1 1 4-4 4 4 0 0 1-4 4z" />
    </svg>
  );
}
