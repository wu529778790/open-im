import { getPublicWebDashboardUrl } from "./constants.js";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * 极简落地页：引导用户使用线上 Web 控制台，本进程仅提供 /api。
 * 不再将完整仪表盘 HTML 打入 npm 包。
 */
export function getConfigWebLandingHtml(): string {
  const web = escapeHtml(getPublicWebDashboardUrl());
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>open-im</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.55; color: #111827; background: #f9fafb; }
      a { color: #2563eb; }
      code { font-size: 0.9em; background: #e5e7eb; padding: 0.15em 0.4em; border-radius: 4px; word-break: break-all; }
      h1 { font-size: 1.25rem; }
    </style>
  </head>
  <body>
    <h1>open-im</h1>
    <p>Web console: <a href="${web}">${web}</a></p>
    <p>API base URL (paste in the web console): <code id="api"></code></p>
    <script>document.getElementById("api").textContent = location.origin;</script>
  </body>
</html>`;
}
