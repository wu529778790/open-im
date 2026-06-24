#!/usr/bin/env node

import { main, needsSetup } from "./index.js";
import { loadConfig } from "./config.js";
import { checkAndUpdate } from "./check-update.js";
import { getPublicWebDashboardUrl } from "./constants.js";
import { getWebDistDir } from "./config-web-static.js";
import { getWebConfigUrl, runWebConfigFlow } from "./config-web.js";
import { getManagerStatus, startManagerProcess, stopManagerProcess } from "./manager-control.js";
import { stopBackgroundService } from "./service-control.js";

/** 控制台与 API 同源时只打一行 */
function logWebDashboardAndApi(): void {
  const dash = getPublicWebDashboardUrl().replace(/\/$/, "");
  const api = getWebConfigUrl().replace(/\/$/, "");
  if (dash === api) {
    console.log(`  web dashboard: ${dash}`);
  } else {
    console.log(`  web dashboard: ${dash}`);
    console.log(`  local API: ${api}`);
  }
}

async function ensureConfigured(mode: "start" | "dev"): Promise<boolean> {
  if (!needsSetup()) {
    try {
      loadConfig();
      return true;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
    }
  }

  const result = await runWebConfigFlow({ mode, cwd: process.cwd() });
  if (result !== "saved") return false;

  try {
    loadConfig();
    return true;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function cmdStart(): Promise<void> {
  const status = getManagerStatus();
  if (status.running && status.pid) {
    console.log("\nopen-im is already running in the background.");
    console.log(`  pid: ${status.pid}`);
    logWebDashboardAndApi();
    process.exit(0);
  }

  if (!(await ensureConfigured("start"))) {
    process.exit(1);
  }

  await checkAndUpdate();

  const child = await startManagerProcess(process.cwd());
  console.log("\nopen-im started in the background.");
  console.log(`  pid: ${child.pid}`);
  logWebDashboardAndApi();
  if (process.env.OPEN_IM_WEB_HOST && process.env.OPEN_IM_WEB_HOST !== "127.0.0.1") {
    console.log("");
    console.log("NOTE:");
    console.log("  The config page is bound to OPEN_IM_WEB_HOST.");
    console.log("  A one-time login URL (with login_token) has been printed by the config-web server logger.");
    console.log("  Please use that URL (replacing 127.0.0.1 with your server IP/hostname) for the first login.");
  }
  process.exit(0);
}

async function cmdStop(): Promise<void> {
  const status = getManagerStatus();
  if (!status.pid) {
    console.log("open-im is not running in the background.");
    process.exit(0);
  }

  await stopBackgroundService();
  const result = await stopManagerProcess();
  console.log("\nopen-im stopped.");
  console.log(`  pid: ${result.pid}`);
  process.exit(0);
}

async function cmdRestart(): Promise<void> {
  const status = getManagerStatus();
  let restartedExistingInstance = false;
  if (status.pid) {
    await stopBackgroundService();
    const stopped = await stopManagerProcess();
    console.log("\nopen-im stopped.");
    console.log(`  pid: ${stopped.pid}`);
    restartedExistingInstance = true;
  } else {
    console.log("\nopen-im is not running in the background.");
  }

  if (!(await ensureConfigured("start"))) {
    process.exit(1);
  }

  await checkAndUpdate();

  const child = await startManagerProcess(process.cwd());
  if (restartedExistingInstance) {
    console.log("\nopen-im restarted in the background.");
  } else {
    console.log("\nopen-im started in the background.");
  }
  console.log(`  pid: ${child.pid}`);
  logWebDashboardAndApi();
  process.exit(0);
}

async function cmdDev(): Promise<void> {
  if (!(await ensureConfigured("dev"))) {
    console.log("Configuration was not completed.");
    process.exit(1);
  }
  await main();
}

async function cmdDashboard(): Promise<void> {
  // Start web config server in persistent mode (no timeout)
  const { startWebConfigServer } = await import("./config-web.js");
  const server = await startWebConfigServer({ mode: "dev", cwd: process.cwd(), persistent: true });
  const publicUrl = getPublicWebDashboardUrl();
  console.log(`\nWeb dashboard: ${publicUrl}`);
  if (!getWebDistDir()) {
    console.log("Note: web/dist not found — GET / returns 503 until you run npm run build (or npm run web:build), or use the published npm package.");
  }
  if (server.loginUrl) {
    console.log(`Remote login: ${server.loginUrl}`);
  }
  console.log("Press Ctrl+C to close.\n");
  await server.waitForResult;
}

function showHelp(exitCode = 0): void {
  console.log(`
Usage: open-im <command>

Commands:
  start     Run the full app in the background and serve the dashboard
  stop      Stop the full app
  restart   Restart the full app in the background
  dev       Run in the foreground for debugging
  dashboard Open the web dashboard (keeps running until Ctrl+C)

Web dashboard (bundled SPA when web/dist is installed):
  ${getPublicWebDashboardUrl()}  (same origin as API; default port 39282)
  - "start" keeps the dashboard and API available while the service runs
  - "dashboard" runs only the web config server (no bridge)
  - "dev" may open the browser during initial setup

Options:
  -h, --help    Show this help message
`);
  process.exit(exitCode);
}

const cmd = process.argv[2];

const commands: Record<string, () => Promise<void>> = {
  start: cmdStart,
  stop: cmdStop,
  restart: cmdRestart,
  dev: cmdDev,
  dashboard: cmdDashboard,
};

if (cmd === "--version" || cmd === "-v") {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const __dirname = join(fileURLToPath(import.meta.url), "..");
  const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));
  console.log(pkg.version);
} else if (cmd === "--help" || cmd === "-h") {
  showHelp(0);
} else if (cmd === undefined) {
  cmdDev().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else if (commands[cmd]) {
  commands[cmd]().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  console.error(`Unknown command: ${cmd}`);
  showHelp(1);
}
