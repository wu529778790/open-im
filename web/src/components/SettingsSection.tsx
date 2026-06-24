import { useEffect, useState } from "react";
import { useApi } from "../context/ApiContext.js";

interface KeepaliveCfg {
  enabled: boolean;
  intervalHours: number;
  target: string;
}

const AI_OPTIONS = [
  { value: "claude", label: "Claude Code" },
  { value: "codex", label: "Codex（暂未实现保活）" },
  { value: "codebuddy", label: "CodeBuddy（暂未实现保活）" },
  { value: "opencode", label: "OpenCode（暂未实现保活）" },
];

export function SettingsSection({ hideHeading = false }: { hideHeading?: boolean }) {
  const R = useApi();
  const [cfg, setCfg] = useState<KeepaliveCfg>({ enabled: true, intervalHours: 5, target: "claude" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: "success" | "error" | "" }>({ text: "", type: "" });

  useEffect(() => {
    (async () => {
      try {
        const data = (await R("/api/keepalive/config")) as KeepaliveCfg;
        setCfg(data);
      } catch (e) {
        setMsg({ text: `加载失败：${e instanceof Error ? e.message : String(e)}`, type: "error" });
      }
    })();
  }, [R]);

  const save = async () => {
    setBusy(true);
    setMsg({ text: "", type: "" });
    try {
      await R("/api/keepalive/config", { method: "POST", body: JSON.stringify(cfg) });
      setMsg({ text: "保活配置已保存，定时器已重启。", type: "success" });
    } catch (e) {
      setMsg({ text: `保存失败：${e instanceof Error ? e.message : String(e)}`, type: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="section">
      {!hideHeading && (
        <div className="section-head">
          <div>
            <h2 className="section-title">设置</h2>
            <p className="section-desc">控制 open-im 的全局行为</p>
          </div>
        </div>
      )}

      {msg.text && (
        <div className={`msg ${msg.type === "success" ? "msg-ok" : "msg-err"}`} style={{ marginBottom: 12 }}>
          {msg.text}
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <span className="card-title">API 保活</span>
        </div>
        <div className="card-body">
          <p className="form-hint" style={{ marginBottom: 16 }}>
            定期向选中的 AI 工具发送轻量级请求（只读查询），用来延续 5 小时滚动重置的 token 配额。
            如果不发请求，未使用的配额会被浪费。
          </p>

          <div className="form-group">
            <label className="toggle">
              <input
                type="checkbox"
                className="toggle-input"
                checked={cfg.enabled}
                onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })}
              />
              <span className="toggle-track" />
              <span className="form-label" style={{ margin: 0 }}>启用 API 保活</span>
            </label>
          </div>

          <div className="form-group">
            <label className="form-label">间隔时间（小时）</label>
            <input
              type="number"
              className="form-input"
              min="1"
              max="24"
              step="1"
              value={cfg.intervalHours}
              onChange={(e) => setCfg({ ...cfg, intervalHours: Number(e.target.value) || 5 })}
              disabled={!cfg.enabled}
              style={{ width: 120 }}
            />
            <p className="field-tip">推荐 4-5 小时。token 通常每 5 小时滚动重置。</p>
          </div>

          <div className="form-group">
            <label className="form-label">使用的 AI 工具</label>
            <select
              className="form-input"
              value={cfg.target}
              onChange={(e) => setCfg({ ...cfg, target: e.target.value })}
              disabled={!cfg.enabled}
              style={{ width: 280 }}
            >
              {AI_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <p className="field-tip">目前仅 Claude Code 已实现保活，其他工具占位。</p>
          </div>

          <div style={{ marginTop: 16 }}>
            <button
              type="button"
              className="btn btn-s btn-sm"
              onClick={() => void save()}
              disabled={busy}
            >
              {busy ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}