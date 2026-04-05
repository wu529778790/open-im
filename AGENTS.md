# AGENTS.md

## Cursor Cloud specific instructions

### Overview

open-im is a single-process Node.js/TypeScript application that bridges IM platforms (Telegram, Feishu, QQ, WeCom, DingTalk, WeChat) to AI CLI tools (Claude, Codex, CodeBuddy). It has **no local infrastructure dependencies** (no databases, Docker, Redis, etc.) — all external dependencies are third-party cloud APIs requiring registration and API keys.

### Development Commands

See `CLAUDE.md` for the full list. Key commands:

- `npm run build` — compile TypeScript to `dist/`
- `npm run dev` — run from source with tsx (foreground)
- `npm run lint` — ESLint on `src/`
- `npm run test` — vitest
- `npm run web:dev` — Vite dev server for the standalone web dashboard (proxies `/api` to `127.0.0.1:39282`)
- `npm run web:build` — production build to `web/dist` (GitHub Pages)
- `node dist/cli.js dashboard` — standalone web config UI on port 39282

### Startup Caveats

- The app requires **at least one IM platform configured** with valid credentials to start the bridge. Without credentials, `npm run dev` will print setup instructions and exit.
- Claude SDK mode (default) requires one of: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, or `ANTHROPIC_BASE_URL` + `ANTHROPIC_MODEL`.
- The `open-im dashboard` (or `node dist/cli.js dashboard`) command starts only the web config UI on port 39282 and does **not** require platform credentials — useful for configuration and testing the web UI independently.
- Internal HTTP services: Permission Server on port 35801, shutdown server on port 39281, web dashboard on port 39282.
- **Remote / GitHub Pages 配置页**：将服务暴露给浏览器跨域调用时，设置 `OPEN_IM_WEB_HOST=0.0.0.0`；在受信网络可用 `OPEN_IM_ALLOW_REMOTE_API=true` 跳过 Web 登录 Cookie（生产建议配合 HTTPS 反向代理）。可选 `OPEN_IM_CORS_ORIGINS`（逗号分隔）限制允许的 `Origin`。从 HTTPS 页面调用 HTTP API 会被浏览器拦截混合内容，需对 API 使用 HTTPS 代理，或通过 HTTP 打开独立页面 `web/index.html`。
- **npm 包**：不再内置完整仪表盘 HTML；`open-im start` 会提示打开线上控制台（默认 `https://open-im.shenzjd.com`，可用 `OPEN_IM_PUBLIC_WEB_URL` 覆盖），本地 `http://127.0.0.1:39282` 仅提供 API 与极简落地页。

### Testing Notes

- Tests run with `npm run test` (vitest) and do not require any external credentials or services.
- Lint warnings (32 warnings, 0 errors) are expected in the current codebase — mostly unused variables and `@typescript-eslint/no-explicit-any`.
- The `punycode` deprecation warning from Node.js is a known harmless warning from a transitive dependency.
