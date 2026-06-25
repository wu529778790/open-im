# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` exists alongside this file (Cursor Cloud / generic agent guidance) and defers to CLAUDE.md for the command list; the two are kept in sync, with startup caveats and telemetry details also covered there.

## Development Commands

```bash
npm run build          # web:build (Vite dashboard) + tsc → dist/
npm run build:ts       # tsc only (skip the Vite bundle)
npm run dev            # run from source via tsx (foreground)
npm start              # node dist/cli.js start (background daemon)
npm stop               # node dist/cli.js stop
npm run restart        # stop then start

npm test               # vitest run (no external credentials)
npm run test:watch     # vitest watch
npm run lint           # eslint src

# Run a single test file / a single test by name:
npx vitest run src/adapters/claude-sdk-adapter.test.ts
npx vitest run -t "resolves the AI command"

# Web dashboard:
npm run web:dev        # Vite dev server (proxies /api → 127.0.0.1:39282)
npm run web:build      # production build into web/dist
```

Compiled CLI entry point is `open-im` → `dist/cli.js`:

```bash
open-im init        # interactive setup wizard
open-im start       # bridge in the background
open-im stop        # stop the background daemon
open-im restart     # stop then start
open-im dashboard   # web config UI on :39282
```

## Project Architecture

open-im is a **single-process** Node.js/TypeScript app with **no local infrastructure** (no DB, Docker, or Redis). It bridges **seven IM platforms** to **four AI CLIs** via a shared pipeline.

### The shared request pipeline

Every inbound IM message follows one path:

1. **Platform client** (`src/<platform>/client.ts`) — connects and emits raw events.
2. **`src/platform/create-event-context.ts`** — normalizes events into `PlatformEventContext`.
3. **`src/platform/handle-text-flow.ts`** — shared flow: access-control → dedup → WAL → chat mapping → command dispatch → AI enqueue.
4. **`src/queue/request-queue.ts`** — serializes requests per user.
5. **`src/platform/handle-ai-request.ts`** — factory that resolves AI adapter, session, and callbacks.
6. **`src/shared/ai-task.ts`** — runs the adapter and streams results back.

Add inbound-path features to `src/platform/`, not per-platform `event-handler.ts`.

### Platform layer (`src/<platform>/`)

Each platform: `client.ts` (connect), `event-handler.ts` (parse → delegate), `message-sender.ts` (send replies).

- **clawbot/** — iLink API long-polling, image download+decrypt, message aggregation (combines consecutive same-user messages)
- **feishu/** — `card-builder.ts`, `cardkit-manager.ts` (interactive cards)
- **dingtalk/** — `streaming-card.ts` (live AI cards), `webhook.ts`
- **workbuddy/** — `centrifuge-client.ts` (tokens expire → re-run `open-im init`)

### AI adapter layer (`src/adapters/`)

`tool-adapter.interface.ts` is the common interface. `registry.ts` picks one by configured AI command.

- **claude-sdk-adapter.ts** — Claude Agent SDK **in-process** (default, fastest). Key options: `tools: { preset: 'claude_code' }`, `skills: 'all'`, `INTERACTIVE_CONTEXT` injected for interactive behavior.
- **codex-adapter.ts** — spawns Codex CLI
- **codebuddy-adapter.ts** — spawns CodeBuddy CLI
- **opencode-adapter.ts** — spawns OpenCode CLI (`opencode run`)

### Commands & sessions

**Slash commands** (`src/commands/handler.ts`):
- Session: `/help`, `/new`, `/sessions`, `/resume`, `/history`, `/delete`, `/rename`, `/fork`
- Info: `/models`, `/context`, `/plugins`, `/status`, `/cd`, `/pwd`, `/mode`, `/a`, `/autopilot`
- Restart: `/restart` (needs `/restart confirm`) — respawns the worker (IM bridge) via the manager supervisor; web dashboard stays online
- Quick: `/git commit`, `/git push`, `/git pull`, `/test`, `/build`, `/review`, `/explain`

**Quick commands** send predefined prompts to the AI (e.g., `/git commit` → "git commit -m 'AI generated'").

### Interactive selection

`src/shared/choice-detector.ts` detects numbered choices in AI output (e.g., "1. Option A\n2. Option B"). Telegram presents these as inline buttons. User clicks a button → choice sent to AI.

### Web dashboard (`web/`)

Single-page React app (Vite + TypeScript). Chinese-first UI, no language toggle.

- `Dashboard.tsx` — orchestrator (stats → platforms → config files)
- `SetupWizard.tsx` — first-run: Claude API → platforms → credentials → save+start
- `PlatformCard.tsx` — collapsible with test button and doc links

API endpoints on port 39282: `/api/config`, `/api/service/*`, `/api/health`, `/api/metrics`, `/api/clawbot/qr-login/*`

### Observability

- **Sentry** — error tracking (opt-in via `OPEN_IM_SENTRY_DSN`, defaults to developer's DSN)
- **Audit log** — `~/.open-im/logs/audit.log` records user interactions
- **Metrics** — `GET /api/metrics` returns uptime, memory, platform status

### Notifications

All IM notifications use `buildNotification()` template:
```
{emoji} {title}

📱 平台: {platform}
🤖 AI: {tool}
📁 目录: {dir}
🧩 插件: {plugins}  (max 3, then "等N个")
💡 {random tip}
```

ClawBot/WorkBuddy send "🤔 正在处理..." immediately (no typing indicator support).

### Shared utilities (`src/shared/`)

- `ai-task.ts` — task execution with Sentry error capture
- `message-wal.ts` — write-ahead log for crash recovery
- `choice-detector.ts` — detects numbered choices in AI output for interactive buttons
- `sentry.ts` — Sentry integration with PII sanitization
- `media-*` — image/file handling for Telegram, Feishu, etc.
- `git-coauthor.ts` — appends `Co-authored-by` (disable: `OPEN_IM_GIT_COAUTHOR=0`)

## Configuration

Config file: **`~/.open-im/config.json`**. Loading: env vars → file config → defaults.

- `enabledPlatforms` derived from credentials (not set manually)
- `allowedUserIds` — user whitelist (empty = everyone)
- Claude SDK resolves: env → `tools.claude.env` → `~/.claude/settings.json`
- Web dashboard saves API fields to `~/.claude/settings.json`

## Design Decisions

- **npm, not pnpm** — all package operations use npm
- **ES Module + Node16** — targets ES2022, Node ≥ 20
- **Shared platform layer** — inbound logic in `src/platform/`, reused by all seven platforms
- **In-process Claude** — SDK adapter is default, no `claude` binary required
- **Message deduplication** — 60s TTL cache in `handle-text-flow.ts` prevents duplicate AI requests
- **Message WAL** — `message-wal.ts` persists incoming messages for crash recovery
- **Chinese-first UI** — web dashboard defaults to Chinese, no language toggle
- **Unified notifications** — `buildNotification()` template for all IM messages
- **Platform naming** — follows WorkBuddy convention (飞书, QQ 机器人, 企业微信, etc.)
