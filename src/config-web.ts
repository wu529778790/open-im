import { createServer, type IncomingMessage } from "node:http";
import { URL } from "node:url";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { WEB_CONFIG_PORT, getPublicWebDashboardUrl } from "./constants.js";
import {
  CONFIG_PATH,
  getClaudeConfigHome,
  loadClaudeSettingsEnv,
  loadConfig,
  loadFileConfig,
  saveFileConfig,
  CODEX_AUTH_PATHS,
} from "./config.js";
import { getWebDistDir, tryServeDashboardStatic } from "./config-web-static.js";
import {
  getWebConfigHost,
  allowRemoteApiWithoutAuth,
  consumeLoginToken,
  createSession,
  isSessionValid,
  buildSessionCookie,
  generateLoginUrl,
} from "./config-web-auth.js";
import { corsHeadersFor, mergeCors } from "./config-web-cors.js";
export { getHealthPlatformSnapshot } from "./config-web-health.js";
import { getHealthPlatformSnapshot } from "./config-web-health.js";
import { readJson, jsonResponse as json } from "./config-web-http.js";
import {
  openBrowser,
  getWebConfigPort,
  getWebConfigUrl,
} from "./config-web-browser.js";
export { getWebConfigUrl } from "./config-web-browser.js";
import {
  type WebConfigPayload,
  buildInitialPayload,
  validatePayload,
  toFileConfig,
  isMasked,
  clean,
} from "./config-web-payload.js";
import { testPlatformConfig, toErrorMessage } from "./config-web-probes.js";
export { testPlatformConfig } from "./config-web-probes.js";
import { getServiceStatus, startBackgroundService, stopBackgroundService } from "./service-control.js";
import { createLogger } from "./logger.js";

const log = createLogger("ConfigWeb");
type WebFlowMode = "init" | "start" | "dev";
type WebFlowResult = "saved" | "cancel";
// 已移至 constants.ts;

// getClaudeSettingsPath is used by /api/claude/settings handler
function getClaudeSettingsPath(): string {
  const home = getClaudeConfigHome();
  const baseDir = join(home, ".claude");
  return join(baseDir, "settings.json");
}

export interface StartedWebConfigServer {
  close: () => Promise<void>;
  url: string;
  waitForResult: Promise<WebFlowResult>;
  loginUrl?: string;
}



export async function startWebConfigServer(options: { mode: WebFlowMode; cwd: string; persistent?: boolean }): Promise<StartedWebConfigServer> {
  let timer: NodeJS.Timeout | null = null;
  let settled = false;
  let settle!: (value: WebFlowResult) => void;
  const waitForResult = new Promise<WebFlowResult>((resolve) => {
    settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
  });

  const host = getWebConfigHost();
  const server = createServer(async (request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const finishFlow = (result: WebFlowResult) => {
        if (timer) clearTimeout(timer);
        server.close();
        settle(result);
      };

      const cors = corsHeadersFor(request);
      if (request.method === "OPTIONS" && cors) {
        response.writeHead(204, cors);
        response.end();
        return;
      }

      // Auth gating:
      // - 当仅绑定 127.0.0.1 时，保持完全本地免登录（向后兼容）
      // - 当绑定到 0.0.0.0 或其他地址时，启用一次性登录 + Session Cookie 机制
      // - OPEN_IM_ALLOW_REMOTE_API=true 时跳过上述校验（受信网络 / 跨域在线配置页配合 CORS 使用）
      const isLocalOnly = host === "127.0.0.1";
      const hasLoginTokenFeature = !isLocalOnly;
      const shouldRequireAuth = hasLoginTokenFeature && !allowRemoteApiWithoutAuth();

      if (shouldRequireAuth) {
        const loginToken = requestUrl.searchParams.get("login_token");
        if (loginToken) {
          const info = consumeLoginToken(loginToken);
          if (info) {
            // 有效的一次性登录 token：创建会话，设置 Cookie，并重定向到去掉 login_token 的 URL
            const sessionTtlMs = 24 * 60 * 60 * 1000; // 24 小时
            const sessionId = createSession(request, sessionTtlMs);
            const cookie = buildSessionCookie(sessionId, sessionTtlMs);

            requestUrl.searchParams.delete("login_token");
            const redirectPath = requestUrl.pathname + (requestUrl.search ? requestUrl.search : "");

            response.writeHead(
              302,
              mergeCors(request, {
                Location: redirectPath || "/",
                "Set-Cookie": cookie,
              }),
            );
            response.end();
            return;
          }

          // 无效或过期的一次性 token
          response.writeHead(401, mergeCors(request, { "content-type": "text/plain; charset=utf-8" }));
          response.end("Invalid or expired login link. Please generate a new one from the server.");
          return;
        }

        // 其他请求：必须已有有效 session
        if (!isSessionValid(request)) {
          response.writeHead(401, mergeCors(request, { "content-type": "text/plain; charset=utf-8" }));
          response.end("Unauthorized. Please open the latest login URL from the server output.");
          return;
        }
      }

      if (request.method === "GET" && requestUrl.pathname === "/") {
        if (tryServeDashboardStatic(requestUrl, request, response, mergeCors)) return;
        response.writeHead(503, mergeCors(request, { "content-type": "text/plain; charset=utf-8" }));
        response.end(
          "open-im: web/dist is missing. Run npm run build in the repository root, then restart.\n",
        );
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/config") {
        json(response, 200, {
          payload: buildInitialPayload(loadFileConfig()),
          meta: { configPath: CONFIG_PATH, mode: options.mode },
        }, request);
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/config/file") {
        try {
          let contents = "{}";
          if (existsSync(CONFIG_PATH)) {
            contents = readFileSync(CONFIG_PATH, "utf-8");
          }
          json(response, 200, { path: CONFIG_PATH, contents }, request);
        } catch (error) {
          json(response, 500, { error: error instanceof Error ? error.message : String(error) }, request);
        }
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/config/file") {
        try {
          const body = await readJson<{ contents?: string }>(request);
          const raw = body.contents ?? "";
          if (!raw.trim()) {
            json(response, 400, { error: "contents is required" }, request);
            return;
          }
          try {
            JSON.parse(raw);
          } catch {
            json(response, 400, { error: "Invalid JSON" }, request);
            return;
          }
          const dir = dirname(CONFIG_PATH);
          if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
          }
          writeFileSync(CONFIG_PATH, raw, "utf-8");
          loadConfig();
          json(response, 200, { message: "Config file saved.", path: CONFIG_PATH }, request);
        } catch (error) {
          json(response, 500, { error: error instanceof Error ? error.message : String(error) }, request);
        }
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/config/validate") {
        try {
          const body = await readJson<WebConfigPayload>(request);
          const errors = validatePayload(body);
          if (errors.length > 0) {
            json(response, 400, { error: errors.join(" ") }, request);
            return;
          }
          json(response, 200, { message: "Configuration looks internally consistent." }, request);
        } catch (error) {
          json(response, 400, { error: error instanceof Error ? error.message : String(error) }, request);
        }
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/config/save") {
        try {
          const body = await readJson<WebConfigPayload>(request);
          const errors = validatePayload(body);
          if (errors.length > 0) {
            json(response, 400, { error: errors.join(" ") }, request);
            return;
          }
          saveFileConfig(toFileConfig(body, loadFileConfig()));
          // Save Codex OPENAI_API_KEY to ~/.codex/auth.json if provided
          const codexApiKey = clean(body.ai.codexApiKey);
          if (codexApiKey && !isMasked(codexApiKey)) {
            const codexAuthPath = CODEX_AUTH_PATHS[0];
            const codexDir = dirname(codexAuthPath);
            if (!existsSync(codexDir)) mkdirSync(codexDir, { recursive: true });
            writeFileSync(codexAuthPath, JSON.stringify({ openai_api_key: codexApiKey }, null, 2), "utf-8");
          }
          loadConfig();
          json(response, 200, { message: "Configuration saved." }, request);
          if (!options.persistent && requestUrl.searchParams.get("final") === "1") {
            setTimeout(() => finishFlow("saved"), 120);
          }
        } catch (error) {
          json(response, 400, { error: error instanceof Error ? error.message : String(error) }, request);
        }
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/service/status") {
        json(response, 200, getServiceStatus(), request);
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/claude/settings") {
        try {
          const settingsPath = getClaudeSettingsPath();
          let contents = "{}";
          if (existsSync(settingsPath)) {
            contents = readFileSync(settingsPath, "utf-8");
          } else {
            // Try to synthesize from env if file doesn't exist yet
            const env = loadClaudeSettingsEnv();
            if (Object.keys(env).length > 0) {
              contents = JSON.stringify({ env }, null, 2);
            }
          }
          json(response, 200, { path: settingsPath, contents }, request);
        } catch (error) {
          json(response, 500, { error: error instanceof Error ? error.message : String(error) }, request);
        }
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/claude/settings") {
        try {
          const body = await readJson<{ contents?: string }>(request);
          const raw = body.contents ?? "";
          if (!raw.trim()) {
            json(response, 400, { error: "contents is required" }, request);
            return;
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw);
          } catch (err) {
            json(response, 400, { error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}` }, request);
            return;
          }
          const pretty = JSON.stringify(parsed, null, 2);
          const settingsPath = getClaudeSettingsPath();
          const dir = dirname(settingsPath);
          if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
          }
          writeFileSync(settingsPath, pretty, "utf-8");
          json(response, 200, { message: "Claude settings.json saved.", path: settingsPath }, request);
        } catch (error) {
          json(response, 500, { error: error instanceof Error ? error.message : String(error) }, request);
        }
        return;
      }

      // --- Codex settings (auth.json) ---
      if (request.method === "GET" && requestUrl.pathname === "/api/codex/settings") {
        try {
          let foundPath = "";
          let contents = "{}";
          for (const p of CODEX_AUTH_PATHS) {
            if (existsSync(p)) {
              foundPath = p;
              contents = readFileSync(p, "utf-8");
              break;
            }
          }
          if (!foundPath && CODEX_AUTH_PATHS.length > 0) {
            foundPath = CODEX_AUTH_PATHS[0];
          }
          json(response, 200, { path: foundPath, contents }, request);
        } catch (error) {
          json(response, 500, { error: error instanceof Error ? error.message : String(error) }, request);
        }
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/codex/settings") {
        try {
          const body = await readJson<{ contents?: string }>(request);
          const raw = body.contents ?? "";
          if (!raw.trim()) {
            json(response, 400, { error: "contents is required" }, request);
            return;
          }
          try {
            JSON.parse(raw);
          } catch (err) {
            json(response, 400, { error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}` }, request);
            return;
          }
          const settingsPath = CODEX_AUTH_PATHS[0];
          const dir = dirname(settingsPath);
          if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
          }
          writeFileSync(settingsPath, raw, "utf-8");
          json(response, 200, { message: "Codex settings saved.", path: settingsPath }, request);
        } catch (error) {
          json(response, 500, { error: error instanceof Error ? error.message : String(error) }, request);
        }
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/health") {
        const file = loadFileConfig();
        const platforms = getHealthPlatformSnapshot(file);
        json(response, 200, { platforms, serviceStatus: getServiceStatus() }, request);
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/metrics") {
        const file = loadFileConfig();
        const platforms = getHealthPlatformSnapshot(file);
        const status = getServiceStatus();
        const uptime = process.uptime();
        const mem = process.memoryUsage();
        json(response, 200, {
          uptime: Math.round(uptime),
          memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
          service: { running: status.running, pid: status.pid },
          platforms: Object.entries(platforms).map(([k, v]) => ({ name: k, configured: v.configured, enabled: v.enabled })),
          timestamp: new Date().toISOString(),
        }, request);
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/service/start") {
        try {
          const config = loadConfig();
          const workDir = config.claudeWorkDir ?? options.cwd;
          const started = startBackgroundService(workDir);
          json(response, 200, { message: `Bridge started with pid ${started.pid}.`, pid: started.pid }, request);
          if (!options.persistent) {
            setTimeout(() => finishFlow("saved"), 120);
          }
        } catch (error) {
          json(response, 400, { error: error instanceof Error ? error.message : String(error) }, request);
        }
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/service/stop") {
        try {
          const result = await stopBackgroundService();
          json(response, 200, { message: result.pid ? `Bridge stopped (pid ${result.pid}).` : "Bridge was already stopped." }, request);
        } catch (error) {
          json(response, 400, { error: error instanceof Error ? error.message : String(error) }, request);
        }
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/config/test") {
        try {
          const body = await readJson<{ platform: string; config: Record<string, unknown> }>(request);
          const { platform, config } = body;
          const message = await testPlatformConfig(platform, config);
          json(response, 200, { message, success: true }, request);
        } catch (error) {
          json(response, 400, { error: toErrorMessage(error), success: false }, request);
        }
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/clawbot/qr-login/start") {
        try {
          const { startQRLogin } = await import("./clawbot/qr-login.js");
          const session = await startQRLogin();
          json(response, 200, { success: true, qrcodeUrl: session.qrcodeUrl, sessionKey: session.sessionKey }, request);
        } catch (error) {
          json(response, 500, { success: false, error: toErrorMessage(error) }, request);
        }
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/clawbot/qr-login/wait") {
        try {
          const body = await readJson<{ sessionKey: string; qrcode: string; qrcodeUrl: string }>(request);
          const { waitForQRLogin } = await import("./clawbot/qr-login.js");
          const session = { sessionKey: body.sessionKey, qrcode: body.qrcode, qrcodeUrl: body.qrcodeUrl, startedAt: Date.now() };
          const result = await waitForQRLogin(session);
          json(response, 200, { success: result.connected, botToken: result.botToken, baseUrl: result.baseUrl, userId: result.userId, message: result.message }, request);
        } catch (error) {
          json(response, 500, { success: false, error: toErrorMessage(error) }, request);
        }
        return;
      }

      if (request.method === "GET" && tryServeDashboardStatic(requestUrl, request, response, mergeCors)) {
        return;
      }

      json(response, 404, { error: "Not found." }, request);
  });

  const port = getWebConfigPort();
  await new Promise<void>((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        reject(new Error(`Web config port ${port} is already in use. Close the existing listener or change OPEN_IM_WEB_PORT.`));
        return;
      }
      reject(error);
    });
    server.listen(port, host, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    settle("cancel");
    return {
      close: async () => {},
      url: "",
      waitForResult,
    };
  }

  if (!options.persistent && options.mode !== "dev") {
    timer = setTimeout(() => {
      server.close();
      settle("cancel");
    }, 15 * 60 * 1000);
  }

  server.on("close", () => {
    if (timer) clearTimeout(timer);
  });

  let loginUrlForReturn: string | undefined;

  // 当绑定到非 127.0.0.1（例如 0.0.0.0）时，为远程访问生成一次性登录链接
  if (host !== "127.0.0.1") {
    const loginTtlMs = 15 * 60 * 1000; // 15 分钟内有效
    loginUrlForReturn = generateLoginUrl(host, port, loginTtlMs);
    const loginUrl = loginUrlForReturn;

    log.info("━━━━━━━━ Web Config Login ━━━━━━━━");
    log.info(`Host binding : ${host}`);
    log.info(`Login URL    : ${loginUrl}`);
    if (host === "0.0.0.0") {
      log.info("Note: replace 127.0.0.1 with your server IP or hostname when opening from another device.");
    }
    log.info(`This login link is valid for approximately ${Math.floor(loginTtlMs / 60000)} minutes and can be used only once.`);
    log.info("After login, subsequent requests will use a short-lived session cookie.");
  }

  return {
    close: async () => {
      if (timer) clearTimeout(timer);
      server.close();
      settle("cancel");
    },
    url: `http://127.0.0.1:${port}`,
    loginUrl: loginUrlForReturn,
    waitForResult,
  };
}

export async function runWebConfigFlow(options: { mode: WebFlowMode; cwd: string }): Promise<WebFlowResult> {
  const started = await startWebConfigServer(options);
  const publicUrl = getPublicWebDashboardUrl();
  const apiUrl = started.url;
  openBrowser(publicUrl);
  log.info(`Opened web console: ${publicUrl}`);
  if (getWebDistDir()) {
    log.info("Full dashboard UI is bundled (same origin as API).");
  } else {
    log.info(`API base: ${apiUrl} — install has no web/dist; GET / returns 503 until you run npm run build.`);
  }
  if (started.loginUrl) {
    log.info(`Remote login (first visit): ${started.loginUrl}`);
  }
  log.info(process.env.OPEN_IM_NO_BROWSER === "1" ? "Browser launch disabled. Open the web console URL manually." : "Save the configuration in your browser to continue.");
  return started.waitForResult;
}
