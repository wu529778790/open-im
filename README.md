# open-im

**English** · [中文](./README.zh-CN.md)

Multi-platform IM bridge for AI CLI tools. Connect Telegram, Feishu, WeCom, DingTalk, QQ, and WeChat (WorkBuddy) to Claude Code, Codex, and CodeBuddy — use your AI coding assistant from any phone or chat window.

## Features

- **Six IM platforms** — Telegram, Feishu, WeCom, DingTalk, QQ, WorkBuddy
- **Three AI backends** — Claude (Agent SDK), Codex, CodeBuddy (per-platform override supported)
- **Streaming, media, sessions** — live output where supported; `/new` for a fresh AI session
- **Web UI** — dashboard bundled in the package; default **`http://127.0.0.1:39282`**

## Requirements

- Node.js ≥ 20
- At least one IM platform configured + credentials for your AI tool

## Quick start

```bash
npx @wu529778790/open-im start
```

Or: `npm install -g @wu529778790/open-im` then `open-im start`.

Config: **`~/.open-im/config.json`**

## CLI

| Command | Description |
| --- | --- |
| `open-im init` | Interactive setup (does not start the bridge) |
| `open-im start` | Run the bridge in the background |
| `open-im stop` | Stop the background bridge |
| `open-im restart` | Stop then start |
| `open-im dashboard` | Web config server only (no bridge) |

After `start`, the CLI prints the dashboard URL (default **`http://127.0.0.1:39282`**).

## Web dashboard

`open-im start` and `open-im dashboard` serve the built-in SPA and **`/api/*`** on **`OPEN_IM_WEB_PORT`** (default **39282**). Open **`http://127.0.0.1:39282`** in a browser (same origin as the API). Override the displayed URL with **`OPEN_IM_PUBLIC_WEB_URL`** if behind a proxy.

**Remote / LAN:** `export OPEN_IM_WEB_HOST=0.0.0.0` — first access from another host may show a one-time login link. Optional: **`OPEN_IM_ALLOW_REMOTE_API`**, **`OPEN_IM_CORS_ORIGINS`**.

## Chat commands

| Command | Description |
| --- | --- |
| `/help` | Help |
| `/new` | New AI session |
| `/sessions` | Session history |
| `/resume <N>` | Resume by list number |
| `/status` | AI + session info |
| `/cd` / `/pwd` | Working directory |
| `/allow` / `/y`, `/deny` / `/n` | Permission prompts |

Session state is stored in **`~/.open-im/data/sessions.json`** (per user, not IM chat logs).

## Configuration

### Per-platform AI

Default: root **`aiCommand`**. Override with **`platforms.<name>.aiCommand`**:

```json
{
  "aiCommand": "claude",
  "platforms": {
    "telegram": { "enabled": true, "aiCommand": "codex" }
  }
}
```

### Claude (Agent SDK)

No local `claude` binary required. Credentials: env → **`config.json`** `env` → **`~/.claude/settings.json`**.

Third-party / compatible API example:

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "your-token",
    "ANTHROPIC_BASE_URL": "https://your-api-endpoint",
    "ANTHROPIC_MODEL": "glm-4.7"
  }
}
```

### CodeBuddy

```bash
npm install -g @tencent-ai/codebuddy-code
codebuddy login
```

### Minimal `config.json` shape

```json
{
  "aiCommand": "claude",
  "tools": {
    "claude": { "workDir": "/path/to/project", "skipPermissions": true, "timeoutMs": 600000 }
  },
  "platforms": {
    "telegram": { "enabled": true, "botToken": "YOUR_TELEGRAM_BOT_TOKEN" }
  }
}
```

Add Feishu, QQ, WeCom, DingTalk, WorkBuddy under **`platforms`** as needed. Run **`open-im init`** for a full template. WeChat (WorkBuddy) is easiest via **`open-im init`**.

### Environment variables

Use **`config.json`** or environment variables; the dashboard exposes common options. Typical keys: **`ANTHROPIC_*`**, **`TELEGRAM_BOT_TOKEN`**, **`OPEN_IM_WEB_PORT`**, **`OPEN_IM_WEB_HOST`**, plus platform-specific `*_APP_ID`, `*_SECRET`, `WORKBUDDY_*`, etc.

### Telemetry (optional)

By default, open-im records **anonymous** diagnostic events (e.g. AI task lifecycle) as JSON lines under the log directory and can **upload** them if you set a collector URL.

- **Opt out**: `OPEN_IM_TELEMETRY=false` or `"telemetry": { "enabled": false }` in **`config.json`** — disables structured events and any upload.
- **Upload**: set **`OPEN_IM_TELEMETRY_URL`** to an **HTTPS** endpoint (full URL to `POST`, NDJSON body). Optional Bearer: **`OPEN_IM_TELEMETRY_TOKEN`** or **`telemetry.token`**. Same keys can be set in **`config.json`** as **`telemetry.url`** / **`telemetry.token`**.
- No chat or prompt content is sent; user identifiers are hashed. A minimal **Cloudflare Worker + R2** example lives in [`examples/telemetry-cloudflare-worker`](examples/telemetry-cloudflare-worker).

### Platform credentials

| Platform | Notes |
| --- | --- |
| Telegram | [@BotFather](https://t.me/BotFather) |
| Feishu | [Open Platform](https://open.feishu.cn/) |
| QQ | [QQ Open Platform](https://bot.q.qq.com/) |
| DingTalk | Open Platform — bot **Stream Mode**; optional **`cardTemplateId`** for AI assistant cards |
| WeCom | [Admin](https://work.weixin.qq.com/) |
| WeChat | **`open-im init`** → WorkBuddy OAuth |

## Troubleshooting

| Issue | What to try |
| --- | --- |
| Telegram / network | `proxy` or **`TELEGRAM_PROXY`** |
| QQ | Check **`QQ_BOT_APPID`** / **`QQ_BOT_SECRET`**; update if duplicate replies |
| Feishu cards | **`/mode ask`** or **`/mode yolo`** without card callbacks |
| WeCom | Send the bot a message first |
| DingTalk | Stream Mode + credentials; custom bots may be text-only |
| Codex disconnect | **`CODEX_PROXY`** or **`tools.codex.proxy`** |
| CodeBuddy login | **`codebuddy login`** |
| WorkBuddy | Re-run **`open-im init`** (tokens expire) |

## License

[MIT](LICENSE)
