import { useMemo, useState } from "react";
import { createRequest, normalizeServerUrl } from "./api.js";
import { ApiProvider } from "./context/ApiContext.js";
import { STORAGE_KEY_SERVER } from "./constants.js";
import { Dashboard } from "./Dashboard.js";

export function App() {
  const [apiBase, setApiBase] = useState("");
  const [connected, setConnected] = useState(false);
  const [connMsg, setConnMsg] = useState<{ text: string; ok: boolean | null }>({ text: "", ok: null });

  const request = useMemo(() => createRequest(() => apiBase), [apiBase]);

  const onConnect = async () => {
    const raw = (document.getElementById("serverUrlInput") as HTMLInputElement | null)?.value ?? "";
    const url = normalizeServerUrl(raw) || (import.meta.env.DEV ? "" : "");
    if (!url && !import.meta.env.DEV) {
      setConnMsg({ text: "Enter server URL (e.g. http://127.0.0.1:39282)", ok: false });
      return;
    }
    setApiBase(url);
    setConnMsg({ text: "Connecting…", ok: null });
    try {
      const testUrl = `${url.replace(/\/$/, "")}/api/health`;
      const res = await fetch(testUrl, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await res.json();
      localStorage.setItem(STORAGE_KEY_SERVER, url);
      setConnMsg({ text: "Connected", ok: true });
      setConnected(true);
    } catch (e) {
      setConnMsg({ text: e instanceof Error ? e.message : String(e), ok: false });
      setApiBase("");
    }
  };

  return (
    <>
      <div className="connection-bar" id="connectionBar" role="banner">
        <div className="connection-bar-inner">
          <label className="connection-label" htmlFor="serverUrlInput">
            Server URL
          </label>
          <input
            id="serverUrlInput"
            className="connection-input"
            type="text"
            placeholder="http://127.0.0.1:39282"
            autoComplete="url"
            spellCheck={false}
            defaultValue={typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY_SERVER) ?? "" : ""}
            onKeyDown={(e) => {
              if (e.key === "Enter") void onConnect();
            }}
          />
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void onConnect()}>
            Connect
          </button>
          <span
            className={`connection-status${connMsg.ok === true ? " ok" : connMsg.ok === false ? " err" : ""}`}
            aria-live="polite"
          >
            {connMsg.text}
          </span>
        </div>
      </div>

      {connected ? (
        <ApiProvider request={request}>
          <div id="mainAppWrap">
            <Dashboard />
          </div>
        </ApiProvider>
      ) : (
        <p style={{ padding: "24px 32px", color: "var(--text-secondary)" }}>Connect to your open-im web API to manage configuration.</p>
      )}
    </>
  );
}
