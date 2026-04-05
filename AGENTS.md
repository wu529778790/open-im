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
- `npm run web:build` — production build to `web/dist` (bundled into the npm package)
- `node dist/cli.js dashboard` — standalone web config UI on port 39282

### Startup Caveats

- The app requires **at least one IM platform configured** with valid credentials to start the bridge. Without credentials, `npm run dev` will print setup instructions and exit.
- Claude SDK mode (default) requires one of: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, or `ANTHROPIC_BASE_URL` + `ANTHROPIC_MODEL`.
- The `open-im dashboard` (or `node dist/cli.js dashboard`) command starts only the web config UI on port 39282 and does **not** require platform credentials — useful for configuration and testing the web UI independently.
- Internal HTTP services: Permission Server on port 35801, shutdown server on port 39281, web dashboard on port 39282.
- **远程访问**：将服务暴露给其他机器时，设置 `OPEN_IM_WEB_HOST=0.0.0.0`；在受信网络可用 `OPEN_IM_ALLOW_REMOTE_API=true` 跳过 Web 登录 Cookie（生产建议配合 HTTPS 反向代理）。可选 `OPEN_IM_CORS_ORIGINS`（逗号分隔）限制允许的 `Origin`。从第三方 **HTTPS** 页面调用本机 **HTTP** API 会被浏览器拦截混合内容；默认用法为打开本机 **`http://127.0.0.1:39282`** 的内置仪表盘（与 API 同源）。
- **npm 包**：包含 `web/dist` 仪表盘静态资源；`open-im start` 默认提示 **`http://127.0.0.1:39282`**（可用 `OPEN_IM_PUBLIC_WEB_URL` 覆盖为反代地址）。无 `web/dist` 时仅返回极简落地页。

### Testing Notes

- Tests run with `npm run test` (vitest) and do not require any external credentials or services.
- Lint warnings (32 warnings, 0 errors) are expected in the current codebase — mostly unused variables and `@typescript-eslint/no-explicit-any`.
- The `punycode` deprecation warning from Node.js is a known harmless warning from a transitive dependency.
