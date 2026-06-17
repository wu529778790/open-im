import { useCallback, useEffect, useMemo, useState } from "react";
import { createRequest, isLoopbackHttpApi, isRemoteHttpsPage, normalizeServerUrl } from "./api.js";
import { ApiProvider } from "./context/ApiContext.js";
import { DEFAULT_SERVER_URL, STORAGE_KEY_SERVER } from "./constants.js";
import { Dashboard } from "./Dashboard.js";
import { IcoLogo } from "./components/icons.js";

function defaultUrl(): string {
  if (typeof window === "undefined") return DEFAULT_SERVER_URL;
  if (isRemoteHttpsPage()) return "";
  return DEFAULT_SERVER_URL;
}
function initialUrl(): string {
  if (typeof localStorage === "undefined") return defaultUrl();
  const s = localStorage.getItem(STORAGE_KEY_SERVER);
  if (s && !(isRemoteHttpsPage() && isLoopbackHttpApi(s))) return s;
  return defaultUrl();
}

export function App() {
  const [base, setBase]               = useState("");
  const [connected, setConnected]     = useState(false);
  const [status, setStatus]           = useState<{ text: string; ok: boolean | null }>({ text: "", ok: null });

  const request = useMemo(() => createRequest(() => base), [base]);

  const connect = useCallback(async (raw: string) => {
    const url = normalizeServerUrl(raw);
    if (isRemoteHttpsPage() && url && isLoopbackHttpApi(url)) {
      setStatus({ text: "HTTPS 页面不能直连 http://127.0.0.1。请使用内置页面或 HTTPS 隧道。", ok: false });
      setBase(""); return;
    }
    if (!url && !import.meta.env.DEV) {
      setStatus({ text: "Enter server URL (e.g. http://127.0.0.1:39282)", ok: false }); return;
    }
    setBase(url); setStatus({ text: "Connecting…", ok: null });
    try {
      await createRequest(() => url)("/api/health");
      localStorage.setItem(STORAGE_KEY_SERVER, url);
      setStatus({ text: "Connected", ok: true }); setConnected(true);
    } catch (e) {
      setStatus({ text: e instanceof Error ? e.message : String(e), ok: false }); setBase("");
    }
  }, []);

  useEffect(() => { const r = initialUrl(); if (r.trim()) void connect(r); }, [connect]);

  if (connected) {
    return (
      <ApiProvider request={request}>
        <div id="mainAppWrap"><Dashboard /></div>
      </ApiProvider>
    );
  }

  const onConnect = () => {
    const v = (document.getElementById("srvUrl") as HTMLInputElement | null)?.value ?? "";
    void connect(v);
  };

  return (
    <div className="conn">
      <div className="conn-card">
        <div className="conn-logo"><IcoLogo /></div>
        <h1 className="conn-title">open-im</h1>
        <p className="conn-desc">Connect to your open-im web API to manage configuration.</p>
        <div className="conn-row">
          <input id="srvUrl" className="conn-input" type="text" placeholder={isRemoteHttpsPage() ? "https://… or open http://127.0.0.1:39282" : DEFAULT_SERVER_URL} autoComplete="url" spellCheck={false} defaultValue={initialUrl()} onKeyDown={(e) => { if (e.key === "Enter") onConnect(); }} />
          <button type="button" className="btn btn-p" onClick={onConnect}>Connect</button>
        </div>
        <p className={`conn-status ${status.ok === true ? "ok" : status.ok === false ? "err" : ""}`} aria-live="polite">{status.text}</p>
      </div>
    </div>
  );
}
