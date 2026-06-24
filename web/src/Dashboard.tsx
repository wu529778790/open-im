import { useCallback, useEffect, useRef, useState } from "react";
import { PLATFORM_DEFINITIONS, PLATFORM_KEYS, POLLING_INTERVAL_MS, STORAGE_KEY_DARK_MODE } from "./constants.js";
import { useI18n } from "./hooks/useI18n.js";
import type { AiCommand, ConfigApiResponse, PlatformKey, WebConfigPayload } from "./types.js";
import { isAiCommand } from "./tool-definitions.js";
import { emptyPayload } from "./empty-payload.js";
import { useApi } from "./context/ApiContext.js";
import { Header } from "./components/Header.js";
import { OverviewStats } from "./components/OverviewStats.js";
import { PlatformCard } from "./components/PlatformCard.js";
import { ConfigFilesSection } from "./components/ConfigFilesSection.js";
import type { ConfigFileEntry } from "./components/ConfigFilesSection.js";
import { AiConfigSection } from "./components/AiConfigSection.js";
import { SetupWizard } from "./components/SetupWizard.js";
import type { DashboardNavId } from "./components/dashboard-nav.js";

function toMsg(e: unknown): string { return e instanceof Error ? e.message : String(e); }
function pretty(raw: string): string { return JSON.stringify(JSON.parse(raw), null, 2) + "\n"; }
// 经 tool-definitions 校验;此前硬编码只认 codex/codebuddy/claude,会把 opencode 降级为 claude。
function normCmd(v: unknown): AiCommand { return v === "" || isAiCommand(v) ? (v as AiCommand) : "claude"; }

function emptyP(): WebConfigPayload {
  return emptyPayload();
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
  const { t, html } = useI18n("zh");
  const [pl, setPl] = useState<WebConfigPayload>(emptyP);
  const [meta, setMeta] = useState({ configPath: "" });
  const [claudeJ, setClaudeJ] = useState("");
  const [codexJ, setCodexJ] = useState("");
  const [codebuddyJ, setCodebuddyJ] = useState("");
  const [opencodeJ, setOpencodeJ] = useState("");
  const [codexConfigT, setCodexConfigT] = useState("");
  const [cfgJ, setCfgJ] = useState("");
  const [origCfgJ, setOrigCfgJ] = useState("");
  const [msg, setMsg] = useState<{ text: string; type: "success" | "error" | "" }>({ text: "", type: "" });
  const [busy, setBusy] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [activeNav, setActiveNav] = useState<DashboardNavId>("overview");
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
        const [cl, cx, cb, oc, ct, fj] = await Promise.all([
          R("/api/claude/settings") as Promise<{ contents?: string }>,
          R("/api/codex/settings") as Promise<{ contents?: string }>,
          R("/api/codebuddy/settings") as Promise<{ contents?: string }>,
          R("/api/opencode/settings") as Promise<{ contents?: string }>,
          R("/api/codex/config") as Promise<{ contents?: string }>,
          R("/api/config/file") as Promise<{ contents?: string }>,
          refreshSvc(), refreshH(),
        ]);
        if (!ok) return;
        const fmt = (r: string | undefined, fb: string) => { const s = (r ?? "").trim(); if (!s) return fb; try { return pretty(s); } catch { return s; } };
        setClaudeJ(fmt(cl.contents, "{\n}\n")); setCodexJ(fmt(cx.contents, "{\n}\n")); setCodebuddyJ(fmt(cb.contents, "{\n}\n")); setOpencodeJ(fmt(oc.contents, "{\n}\n"));
        setCodexConfigT((ct.contents ?? "").trim());
        const rj = (fj.contents ?? "").trim(); setOrigCfgJ(rj); setCfgJ(fmt(fj.contents, "{}\n"));
      } catch (e) { if (ok) setMsg({ text: toMsg(e), type: "error" }); } finally { if (ok) setBusy(false); }
    })();
    return () => { ok = false; };
  }, [R, refreshH, refreshSvc]);

  useEffect(() => { const id = window.setInterval(() => { void refreshSvc(); void refreshH(); }, POLLING_INTERVAL_MS); return () => window.clearInterval(id); }, [refreshH, refreshSvc]);

  useEffect(() => {
    if (!msg.text) return;
    const timeoutMs = msg.type === "error" ? 5200 : 3200;
    const timer = window.setTimeout(() => setMsg({ text: "", type: "" }), timeoutMs);
    return () => window.clearTimeout(timer);
  }, [msg]);

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
  const saveCodebuddy = async () => { await R("/api/codebuddy/settings", { method: "POST", body: JSON.stringify({ contents: codebuddyJ }) }); };
  const saveOpencode = async () => { await R("/api/opencode/settings", { method: "POST", body: JSON.stringify({ contents: opencodeJ }) }); };
  const saveCodexConfig = async () => { await R("/api/codex/config", { method: "POST", body: JSON.stringify({ contents: codexConfigT }) }); };
  const saveCfg = async () => { const j = cfgJ.trim(); if (!j) return; JSON.parse(j); await R("/api/config/file", { method: "POST", body: JSON.stringify({ contents: j }) }); setOrigCfgJ(j); };
  const onSave = async () => { const e = clientErrs(); if (e.length) { setMsg({ text: e.join(" "), type: "error" }); return; } setBusy(true); try { await Promise.all([saveClaude(), saveCodex(), saveCodebuddy(), saveOpencode(), saveCodexConfig(), saveCfg()]); await R("/api/config/save?final=1", { method: "POST", body: JSON.stringify(buildP()) }); setMsg({ text: t("saveOk"), type: "success" }); } catch (x) { setMsg({ text: toMsg(x), type: "error" }); } finally { setBusy(false); } };
  const onStart = async () => { const e = clientErrs(); if (e.length) { setMsg({ text: e.join(" "), type: "error" }); return; } setBusy(true); try { await Promise.all([saveClaude(), saveCodex(), saveCodebuddy(), saveOpencode(), saveCodexConfig(), R("/api/config/save", { method: "POST", body: JSON.stringify(buildP()) })]); await R("/api/service/start", { method: "POST" }); await Promise.all([refreshSvc(), refreshH()]); setMsg({ text: t("startOk"), type: "success" }); } catch (x) { setMsg({ text: toMsg(x), type: "error" }); } finally { setBusy(false); } };
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
  const persistPatch = useCallback(async (pk: PlatformKey, patch: Record<string, unknown>) => {
    const newPl: WebConfigPayload = { ...pl, platforms: { ...pl.platforms, [pk]: { ...pl.platforms[pk], ...patch } } };
    setPl(newPl);
    const payload = { ...newPl, ai: { ...newPl.ai, hookPort: Number(newPl.ai.hookPort) || 0 } };
    try {
      await R("/api/config/save", { method: "POST", body: JSON.stringify(payload) });
      setMsg({ text: t("saveOk"), type: "success" });
      // 配置已写盘，但运行中的 bridge 仍用旧配置。询问用户是否重启以立即生效。
      if (svc.running && window.confirm("配置已保存。需要立即重启 bridge 以使更改生效吗？")) {
        setBusy(true);
        try {
          await R("/api/service/stop", { method: "POST" });
          await R("/api/service/start", { method: "POST" });
          await refreshSvc();
          setMsg({ text: "配置已保存，bridge 已重启。", type: "success" });
        } catch (x) {
          setMsg({ text: toMsg(x), type: "error" });
        } finally {
          setBusy(false);
        }
      }
    } catch (x) {
      setMsg({ text: toMsg(x), type: "error" });
    }
  }, [pl, R, t, svc, refreshSvc]);
  const fmtJson = () => { try { setCfgJ(pretty(cfgJ)); } catch { setJv({ text: t("jsonInvalid", { error: "parse" }), type: "error" }); } };
  const resetJson = () => setCfgJ(origCfgJ ? `${origCfgJ}\n` : "{}\n");
  const toggleDark = () => { const n = !document.documentElement.classList.contains("dark"); document.documentElement.classList.toggle("dark", n); localStorage.setItem(STORAGE_KEY_DARK_MODE, n ? "true" : "false"); };
  const onWizardDone = async () => { setShowWizard(false); try { const d = (await R("/api/config")) as ConfigApiResponse; setPl(coerce(d.payload)); setMeta({ configPath: d.meta.configPath }); await Promise.all([refreshSvc(), refreshH()]); } catch {} };
  const sectionMeta: Record<DashboardNavId, { title: string; hint: string; actions: boolean }> = {
    overview: { title: t("dashboardTitle"), hint: t("dashboardSubtitleFull"), actions: false },
    platforms: { title: t("platformsTitle"), hint: t("platformsHint"), actions: true },
    files: { title: t("configFilesTitle"), hint: t("configFilesHint"), actions: true },
    ai: { title: t("aiTitle"), hint: t("aiHint"), actions: true },
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--c-bg)" }}>
      <Header
        toggleDark={toggleDark}
        serviceStatus={svc}
        busy={busy}
        onValidate={() => void onValidate()}
        onSave={() => void onSave()}
        onToggleService={() => void onToggle()}
        activeNav={activeNav}
        onNavigate={setActiveNav}
        sectionTitle={sectionMeta[activeNav].title}
        sectionHint={sectionMeta[activeNav].hint}
        showPrimaryActions={sectionMeta[activeNav].actions}
        t={t}
      />

      <div className="content">
        {msg.text && (
          <div className="toast-stack" aria-live="polite" aria-atomic="true">
            <div
              className={`toast-msg msg ${msg.type === "success" ? "msg-ok" : "msg-err"}`}
              role={msg.type === "error" ? "alert" : "status"}
            >
              <div className="toast-msg-body">{msg.text}</div>
              <button
                type="button"
                className="toast-close"
                aria-label="关闭通知"
                onClick={() => setMsg({ text: "", type: "" })}
              >
                ×
              </button>
            </div>
          </div>
        )}

        {showWizard ? (
          <SetupWizard request={R} t={t} html={html} onComplete={() => void onWizardDone()} initialPayload={pl} />
        ) : (
          <>
            {activeNav === "overview" && (
              <OverviewStats health={health} serviceStatus={svc} t={t} />
            )}

            {activeNav === "platforms" && (
              <section className="section">
                <div className="platform-grid">
                  {PLATFORM_DEFINITIONS.map((def) => {
                    const pk = def.key as PlatformKey;
                    return <PlatformCard key={pk} def={def} values={pl.platforms[pk]} t={t} html={html} disabledVisual={false} request={R} onChange={(p) => upP(pk, p)} onPersist={(p) => void persistPatch(pk, p)} onTest={() => void onTest(pk)} testing={tBusy === pk} testResult={tMsg[pk]} />;
                  })}
                </div>
              </section>
            )}

            {activeNav === "files" && (() => {
              const configFiles: ConfigFileEntry[] = [
                { id: "config", group: "open-im", label: "config.json", hint: "open-im 完整配置。先格式化再保存；JSON 不合法时无法写入。", path: meta.configPath, content: cfgJ, setContent: setCfgJ, onSave: saveCfg, onFormat: fmtJson, onReset: resetJson, validation: jv },
                { id: "claude", group: "Claude", label: "settings.json", hint: "Claude SDK 环境变量（ANTHROPIC_API_KEY、ANTHROPIC_BASE_URL、ANTHROPIC_MODEL 等）。在此配置 API，无需在终端 export。", path: "~/.claude/settings.json", content: claudeJ, setContent: setClaudeJ, onSave: saveClaude },
                { id: "codex-auth", group: "Codex", label: "auth.json", hint: "Codex CLI 认证信息（OPENAI_API_KEY 等）。在此配置 API 访问。", path: "~/.codex/auth.json", content: codexJ, setContent: setCodexJ, onSave: saveCodex },
                { id: "codex-config", group: "Codex", label: "config.toml", hint: "Codex CLI 配置（模型、Base URL、Model Provider 等）。TOML 格式。", path: "~/.codex/config.toml", content: codexConfigT, setContent: setCodexConfigT, onSave: saveCodexConfig },
                { id: "codebuddy", group: "CodeBuddy", label: "settings.json", hint: "CodeBuddy CLI 配置（模型、插件、沙箱规则等）。直接编辑。", path: "~/.codebuddy/settings.json", content: codebuddyJ, setContent: setCodebuddyJ, onSave: saveCodebuddy },
                { id: "opencode", group: "OpenCode", label: "opencode.json", hint: "OpenCode SDK 配置（MCP 服务器等）。直接编辑。", path: "~/.config/opencode/opencode.json", content: opencodeJ, setContent: setOpencodeJ, onSave: saveOpencode },
              ];
              return <ConfigFilesSection files={configFiles} hideHeading />;
            })()}

            {activeNav === "ai" && (
              <AiConfigSection
                ai={pl.ai}
                onUpdate={(patch) => setPl((prev) => ({ ...prev, ai: { ...prev.ai, ...patch } }))}
                t={t}
                html={html}
                hideHeading
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
