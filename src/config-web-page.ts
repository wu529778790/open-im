import { getPublicWebDashboardUrl } from "./constants.js";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * 无内置 `web/dist` 时的极简落地页（例如从源码运行且未执行 web:build）。
 * 发布到 npm 的包通常包含构建产物，由 config-web-static 直接提供 SPA。
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
    <p>No bundled dashboard (<code>web/dist</code> missing). Run <code>npm run web:build</code> in the repo, or install the published npm package.</p>
    <p>Console URL when bundled: <a href="${web}">${web}</a></p>
    <p>API base: <code id="api"></code></p>
    <script>document.getElementById("api").textContent = location.origin;</script>
  </body>
</html>`;
}
