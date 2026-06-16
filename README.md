# open-im

**English** · [中文](./README.zh-CN.md)

Multi-platform IM bridge for AI CLI tools. Connect Telegram, Feishu, WeCom, DingTalk, QQ, WeChat (WorkBuddy), and WeChat (ClawBot) to Claude Code, Codex, and CodeBuddy — use your AI coding assistant from any phone or chat window.

## Architecture

![Open-IM Architecture](./diagram/architecture/open-im-architecture.svg)

## Features

- **Seven IM platforms** — Telegram, Feishu, WeCom, DingTalk, QQ, WorkBuddy, ClawBot
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

## Git co-authors

`Co-authored-by` is appended by default on AI-driven commits. **Disable:** set **`OPEN_IM_GIT_COAUTHOR=0`** in the environment and restart the bridge.

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

## Session continuity

open-im and Claude Code CLI share the same session storage. When you work in the same directory, you can seamlessly switch between phone and computer.

**Phone → Computer:** open-im automatically resumes the latest CLI session in the same directory — no configuration needed.

**Computer → Phone:** use `claude --continue` (or `claude -c`) to pick up the conversation that was continued on open-im.

```
# On computer
cd /my-project && claude        # work as usual, then Ctrl+C

# On phone (via IM)
"help me fix the login bug"     # open-im auto-resumes the same session

# Back on computer
claude -c                       # continues the phone conversation
```

> **Note:** only one side can be active at a time. Exit the CLI before sending messages from the phone, and vice versa.

## Configuration

### Per-platform AI

Set **`platforms.<name>.aiCommand`** per channel (`claude` / `codex` / `codebuddy`). If unset, the process **`AI_COMMAND`** env var is used when present; otherwise it defaults to **`claude`**.

```json
{
  "platforms": {
    "telegram": { "enabled": true, "aiCommand": "codex", "botToken": "..." }
  }
}
```

### Claude (Agent SDK)

No local `claude` binary required. Credentials: env → **`config.json`** **`tools.claude.env`** → **`~/.claude/settings.json`** (dashboard saves API fields here).

Third-party / compatible API example:

```json
{
  "tools": {
    "claude": {
      "workDir": "/path/to/project",
      "env": {
        "ANTHROPIC_AUTH_TOKEN": "your-token",
        "ANTHROPIC_BASE_URL": "https://your-api-endpoint",
        "ANTHROPIC_MODEL": "glm-4.7"
      }
    }
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
  "tools": {
    "claude": { "workDir": "/path/to/project", "skipPermissions": true, "timeoutMs": 600000 }
  },
  "platforms": {
    "telegram": { "enabled": true, "aiCommand": "claude", "botToken": "YOUR_TELEGRAM_BOT_TOKEN" }
  }
}
```

Add Feishu, QQ, WeCom, DingTalk, WorkBuddy under **`platforms`** as needed. Run **`open-im init`** for a full template. WeChat (WorkBuddy) is easiest via **`open-im init`**.

### Environment variables

Use **`config.json`** (platforms, `tools.*`, etc.) or environment variables; the dashboard exposes common options. Typical keys: **`ANTHROPIC_*`** (shell or **`tools.claude.env`**), **`TELEGRAM_BOT_TOKEN`**, **`OPEN_IM_WEB_PORT`**, **`OPEN_IM_WEB_HOST`**, plus platform-specific `*_APP_ID`, `*_SECRET`, `WORKBUDDY_*`, etc. The root-level **`config.json` `env`** field is no longer read.

### Privacy

**Anonymous** usage information may be collected to improve reliability (no chat or prompt content). To disable: **`OPEN_IM_TELEMETRY=false`** or **`"telemetry": { "enabled": false }`** in **`config.json`**.

### Platform credentials

| Platform | Notes |
| --- | --- |
| Telegram | [@BotFather](https://t.me/BotFather) |
| Feishu | [Open Platform](https://open.feishu.cn/) |
| QQ | [QQ Open Platform](https://bot.q.qq.com/) |
| DingTalk | Open Platform — bot **Stream Mode**; optional **`cardTemplateId`** for AI assistant cards |
| WeCom | [Admin](https://work.weixin.qq.com/) |
| WeChat | **`open-im init`** → WorkBuddy OAuth |
| ClawBot (WeChat) | QR code login via iLink API; see [ClawBot setup](#clawbot-setup) |

### ClawBot setup

ClawBot connects to WeChat via the official iLink Bot API (same protocol as `@tencent-weixin/openclaw-weixin`). It supports text, voice, image, file, and video messages.

**Setup:**

1. Enable in config:
   ```json
   {
     "platforms": {
       "clawbot": { "enabled": true }
     }
   }
   ```
2. Open the Web dashboard → **ClawBot** section → **Scan QR code** with WeChat.
3. After scanning, `bot_token` and `apiUrl` are saved automatically.

**Config fields:**

| Field | Default | Description |
| --- | --- | --- |
| `apiUrl` | `https://ilinkai.weixin.qq.com` | iLink API base URL |
| `apiToken` | — | Bot token (auto-set after QR login) |
| `aiCommand` | `claude` | AI backend override |

**Protocol:** POST + JSON body + Bearer token auth. Long-polling via `ilink/bot/getupdates` with `get_updates_buf` cursor.

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
| ClawBot | QR re-login via Web UI; `apiUrl` defaults to `https://ilinkai.weixin.qq.com` |

## License

[MIT](LICENSE)
