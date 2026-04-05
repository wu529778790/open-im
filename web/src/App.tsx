import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createRequest,
  isLoopbackHttpApi,
  isRemoteHttpsPage,
  normalizeServerUrl,
} from "./api.js";
import { ApiProvider } from "./context/ApiContext.js";
import { DEFAULT_SERVER_URL, STORAGE_KEY_SERVER } from "./constants.js";
import { Dashboard } from "./Dashboard.js";

/** 非本机 HTTPS 页（如第三方托管）无法默认连本机 HTTP */
function defaultServerUrlForPage(): string {
  if (typeof window === "undefined") return DEFAULT_SERVER_URL;
  if (isRemoteHttpsPage()) return "";
  return DEFAULT_SERVER_URL;
}

function initialServerUrl(): string {
  if (typeof localStorage === "undefined") return defaultServerUrlForPage();
  const saved = localStorage.getItem(STORAGE_KEY_SERVER);
  if (saved && !(isRemoteHttpsPage() && isLoopbackHttpApi(saved))) return saved;
  return defaultServerUrlForPage();
}

export function App() {
  const [apiBase, setApiBase] = useState("");
  const [connected, setConnected] = useState(false);
  const [connMsg, setConnMsg] = useState<{ text: string; ok: boolean | null }>({ text: "", ok: null });

  const request = useMemo(() => createRequest(() => apiBase), [apiBase]);

  const connectWithUrl = useCallback(async (raw: string) => {
    const url = normalizeServerUrl(raw);
    if (isRemoteHttpsPage() && url && isLoopbackHttpApi(url)) {
      setConnMsg({
        text:
          "HTTPS 页面不能直连 http://127.0.0.1。请使用 open-im 内置页面（http://127.0.0.1:39282）或 HTTPS 隧道 URL。",
        ok: false,
      });
      setApiBase("");
      return;
    }
    if (!url && !import.meta.env.DEV) {
      setConnMsg({ text: "Enter server URL (e.g. http://127.0.0.1:39282)", ok: false });
      return;
    }
    setApiBase(url);
    setConnMsg({ text: "Connecting…", ok: null });
    try {
      const testReq = createRequest(() => url);
      await testReq("/api/health");
      localStorage.setItem(STORAGE_KEY_SERVER, url);
      setConnMsg({ text: "Connected", ok: true });
      setConnected(true);
    } catch (e) {
      setConnMsg({ text: e instanceof Error ? e.message : String(e), ok: false });
      setApiBase("");
    }
  }, []);

  const onConnect = async () => {
    const raw = (document.getElementById("serverUrlInput") as HTMLInputElement | null)?.value ?? "";
    await connectWithUrl(raw);
  };

  useEffect(() => {
    const raw = initialServerUrl();
    if (!raw.trim()) return;
    void connectWithUrl(raw);
  }, [connectWithUrl]);

  return (
    <>
      {connected ? (
        <ApiProvider request={request}>
          <div id="mainAppWrap">
            <Dashboard />
          </div>
        </ApiProvider>
      ) : (
        <div className="connection-setup">
          <p className="connection-setup-hint">
            Connect to your open-im web API to manage configuration.
          </p>
          <div className="connection-setup-row">
            <label className="connection-label" htmlFor="serverUrlInput">
              Server URL
            </label>
            <input
              id="serverUrlInput"
              className="connection-input"
              type="text"
              placeholder={
                isRemoteHttpsPage()
                  ? "https://… (tunnel) or open built-in http://127.0.0.1:39282"
                  : DEFAULT_SERVER_URL
              }
              autoComplete="url"
              spellCheck={false}
              defaultValue={initialServerUrl()}
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
      )}
    </>
  );
}
