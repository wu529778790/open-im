# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` exists alongside this file (Cursor Cloud / generic agent guidance) and defers to CLAUDE.md for the command list; the two are kept in sync, with startup caveats and telemetry details also covered there.

## Development Commands

```bash
npm run build          # web:build (Vite dashboard) + tsc → dist/   (run before testing the compiled CLI)
npm run build:ts       # tsc only (skip the Vite bundle when you didn't touch web/)
npm run dev            # run from source via tsx (foreground, no build)
npm start              # node dist/cli.js start  (background daemon)
npm stop               # node dist/cli.js stop
npm run restart        # node dist/cli.js restart

npm test               # vitest run            (no external credentials/services required)
npm run test:watch     # vitest watch
npm run lint           # eslint src            (warnings expected, 0 errors is the norm)

# Run a single test file / a single test by name:
npx vitest run src/adapters/claude-sdk-adapter.test.ts
npx vitest run -t "resolves the AI command"

# Web dashboard (standalone SPA + /api on :39282):
npm run web:dev        # Vite dev server (proxies /api → 127.0.0.1:39282)
npm run web:build      # production build into web/dist (bundled into the npm package)
```

Compiled CLI entry point is `open-im` → `dist/cli.js`:

```bash
open-im init        # interactive setup wizard (does NOT start the bridge)
open-im start       # bridge in the background (prints the dashboard URL)
open-im stop        # stop the background daemon
open-im restart     # stop then start
open-im dashboard   # web config UI ONLY on :39282 — needs no platform credentials
```

## Project Architecture

open-im is a **single-process** Node.js/TypeScript app with **no local infrastructure** (no DB, Docker, or Redis). It bridges six IM platforms to three AI CLIs. The big picture is a **shared pipeline** that every platform funnels into, so most logic lives once rather than being copy-pasted per platform.

### The shared request pipeline (read these together)

Every inbound IM message follows one path. Understanding these three files is the key to the whole codebase:

1. **Platform client** (`src/<platform>/client.ts`) — connects (Telegraf / Lark WS / dingtalk-stream / WeCom WS / qq-official / Centrifuge) and emits raw events.
2. **`src/platform/create-event-context.ts`** — normalizes each platform's raw event into a common `PlatformEventContext` (chatId, userId, text, media, reply target). The platform handler does platform-specific parsing, then hands the context off.
3. **`src/platform/handle-text-flow.ts`** — the **shared text flow** all six platforms share: access-control check → `setActiveChatId` → `setChatUser` → `commandHandler.dispatch(...)` (slash commands) → if not a command, enqueue the AI request → handle queue-full/queued feedback.
4. **`src/queue/request-queue.ts`** — serializes requests per user so one user can't interleave AI runs.
5. **`src/platform/handle-ai-request.ts`** — a **factory** (`createPlatformAIRequestHandler`) that replaces ~80 lines of per-platform duplication: resolve AI command + adapter, resolve session, send the "thinking" placeholder, start the typing indicator, then call `runAITask` with platform-specific callbacks.
6. **`src/shared/ai-task.ts`** — `runAITask` runs the chosen adapter and streams results back through the platform's `message-sender.ts`.

When you add a feature to the inbound path, default to putting it in `src/platform/` and reusing it everywhere — not copying it into each `event-handler.ts`.

### Platform layer (`src/<platform>/`)

Each of `telegram/ feishu/ dingtalk/ qq/ wework/ workbuddy/` follows the same shape: `client.ts` (connect), `event-handler.ts` (parse → delegate to the shared platform layer), `message-sender.ts` (send/`edit` replies). Heavier platforms have more:

- **feishu/** — `card-builder.ts`, `cardkit-manager.ts` (interactive cards), `permission.ts`.
- **dingtalk/** — `streaming-card.ts` (live AI cards), `webhook.ts`, `api.ts` (REST calls).
- **wework/**, **workbuddy/** — extra `types.ts`; workbuddy has `oauth.ts` + `centrifuge-client.ts` (tokens expire → re-run `open-im init`).

### AI adapter layer (`src/adapters/`)

`tool-adapter.interface.ts` is the common interface; `registry.ts` picks one by configured AI command. `claude-sdk-adapter.ts` uses the Claude Agent SDK **in-process** (no `claude` binary spawned — the default and fastest path). `codex-adapter.ts` and `codebuddy-adapter.ts` spawn their CLIs; the spawn/protocol logic lives in `src/codex/cli-runner.ts` and `src/codebuddy/cli-runner.ts`. Which adapter a channel uses is resolved per-platform (`platforms.<name>.aiCommand`, then env `AI_COMMAND`, then `claude`).

### Commands & sessions

- **`src/commands/handler.ts`** — dispatches slash commands seen in chat (`/help`, `/new`, `/sessions`, `/resume <N>`, `/status`, `/cd`, `/pwd`, `/allow`/`/y`, `/deny`/`/n`, `/mode`). `normalize-command.ts` handles matching/aliases.
- **`src/session/session-manager.ts`** — per-user session state (workDir, sessionId, conversation IDs), persisted to `~/.open-im/data/sessions.json`; `/new` resets a conversation. Each user is isolated.

### Web dashboard & service lifecycle

- **`src/config-web.ts`** serves the built SPA (`web/dist`, Vite app in `web/`) plus `/api/*` on the web port. **`src/manager.ts`** / **`src/manager-control.ts`** / **`src/service-control.ts`** manage the background daemon lifecycle.
- Internal HTTP ports: **permission server 35801**, **shutdown server 39281**, **web dashboard 39282** (override via `OPEN_IM_WEB_PORT` / `OPEN_IM_WEB_HOST`). Expose over LAN with `OPEN_IM_WEB_HOST=0.0.0.0`; trusted-LAN shortcut `OPEN_IM_ALLOW_REMOTE_API=true` skips the web login cookie (pair with an HTTPS reverse proxy in production).

### Shared utilities (`src/shared/`)

Cross-platform helpers beyond `ai-task.ts`: `active-chats.ts` (current chat per platform), `chat-user-map.ts`, `git-coauthor.ts` (appends `Co-authored-by`; disable via `OPEN_IM_GIT_COAUTHOR=0`), `media-*` (media-context / -prompt / -storage / -analysis-prompt for image/file inputs), `message-note.ts`, `message-title.ts`, `system-messages.ts`, `task-cleanup.ts`, `utils.ts`.

### Telemetry (`src/telemetry/`, `telemetry-cloudflare-worker/`)

Anonymous structured events are **on by default** (JSONL under the log dir; uploaded only when `OPEN_IM_TELEMETRY_URL` is set to an HTTPS collector). No chat/prompt bodies; user keys are hashed. Opt out with `OPEN_IM_TELEMETRY=false` or `telemetry.enabled: false` in config. Reference collector is the bundled Cloudflare Worker.

## Configuration

Config file: **`~/.open-im/config.json`**. Loading precedence: env vars → file config → defaults. `enabledPlatforms` is derived from which platform credentials are present (not set manually). `allowedUserIds` is the user whitelist (empty = everyone). Claude (SDK mode) resolves credentials: env → `tools.claude.env` in config → `~/.claude/settings.json` (the dashboard saves API fields there). The root-level config `env` field is **no longer read**. Setup wizard: `src/setup.ts` (prints manual instructions if stdin is not a TTY).

## Important Design Decisions

- **npm, not pnpm** — use npm for all package operations.
- **ES Module + Node16** — `tsconfig` targets ES2022, `module/moduleResolution: Node16`; **Node ≥ 20**.
- **Shared platform layer first** — inbound-path logic belongs in `src/platform/`, reused by all six platforms, not duplicated into each `event-handler.ts`.
- **In-process Claude** — the Claude Agent SDK adapter is the default; no local `claude` binary is required.
- **Request queue** — `src/queue/request-queue.ts` serializes per user to prevent interleaved AI runs.
- **Access control** — `src/access/access-control.ts` validates user IDs against `allowedUserIds`.
