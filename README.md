# open-im

**English** · [中文](./README.zh-CN.md)

Multi-platform IM bridge for AI CLI tools. Connect Telegram, Feishu, WeCom, DingTalk, QQ, and WeChat (WorkBuddy) to Claude Code, Codex, and CodeBuddy — use your AI coding assistant from any phone or chat window.

## Features

- **Six IM platforms** — run Telegram, Feishu, WeCom, DingTalk, QQ, and WorkBuddy together
- **Three AI backends** — Claude (Agent SDK), Codex, CodeBuddy
- **Per-platform AI routing** — override the default tool per platform
- **Streaming replies** — live AI output where the platform supports it
- **Media** — images, files, voice, and video for analysis (platform-dependent)
- **Session isolation** — per-user state; `/new` resets the AI session
- **Web configuration** — full UI on the hosted dashboard; local process exposes HTTP API on port `39282`
- **Chat commands** — `/help`, `/new`, `/cd`, `/pwd`, `/status`, `/allow`, `/deny`

## Requirements

- Node.js ≥ 20
- At least one IM platform configured
- Credentials for the AI tool you use

## Quick start

```bash
npx @wu529778790/open-im start
```

Or install globally:

```bash
npm install -g @wu529778790/open-im
open-im start
```

Configuration file: `~/.open-im/config.json`

## CLI

| Command | Description |
| --- | --- |
| `open-im init` | Interactive setup without starting the bridge |
| `open-im start` | Run the bridge in the background |
| `open-im stop` | Stop the background bridge |
| `open-im restart` | Stop then start |
| `open-im dev` | Foreground mode for debugging |
| `open-im dashboard` | Keep only the local config HTTP server (no bridge) |

After `start`, the CLI prints the **web dashboard** URL and the **local API** base (`http://127.0.0.1:39282` by default).

## Web configuration

### Hosted dashboard (full UI)

The npm package does **not** ship the large in-browser dashboard as static HTML. Use the **web console** for the full UI (overview, platforms, AI settings, JSON editors, service controls).

- Default URL: **https://open-im.shenzjd.com**
- Override with environment variable: **`OPEN_IM_PUBLIC_WEB_URL`**

In the web console, set the **server address** to your machine’s API base, e.g. `http://127.0.0.1:39282` or `http://<your-lan-ip>:39282`.

### Local HTTP service

The running process listens on **`OPEN_IM_WEB_PORT`** (default **39282**):

- **`GET /`** — small landing page with a link to the web console and the current API origin
- **`/api/*`** — JSON API used by the dashboard

### Remote access

For access from another host or from an HTTPS-hosted page:

```bash
export OPEN_IM_WEB_HOST=0.0.0.0
# Optional: skip cookie login on trusted networks (see security implications in docs)
# export OPEN_IM_ALLOW_REMOTE_API=true
# Optional: restrict CORS origins (comma-separated)
# export OPEN_IM_CORS_ORIGINS=https://open-im.shenzjd.com
```

If the server is not bound to `127.0.0.1`, it may print a **one-time login URL** (`login_token=…`) for first-time browser access.

### Developing the web UI (from source)

In the repository:

```bash
npm run web:dev    # Vite dev server; proxies /api to 127.0.0.1:39282
npm run web:build  # Production build → web/dist
```

**GitHub Pages (this repo’s workflow):** in the repository, enable **Settings → Pages → Build and deployment → Source: GitHub Actions** once. Then pushes that touch `web/` run `.github/workflows/deploy-web.yml`.

More detail: [CLAUDE.md](./CLAUDE.md), [AGENTS.md](./AGENTS.md).

## IM commands

| Command | Description |
| --- | --- |
| `/help` | Help |
| `/new` | New AI session |
| `/status` | AI tool and session info |
| `/cd <path>` | Change session working directory |
| `/pwd` | Print working directory |
| `/allow` / `/y` | Approve a permission request |
| `/deny` / `/n` | Reject a permission request |

## Sessions

Sessions are stored in `~/.open-im/data/sessions.json`, separate from IM chat history. Each user has an isolated session. `/new` clears the current AI session.

## Configuration

### Per-platform AI tool

Default: root `aiCommand`. Override per platform with `platforms.<name>.aiCommand`:

```json
{
  "aiCommand": "claude",
  "platforms": {
    "telegram": { "enabled": true, "aiCommand": "codex" },
    "feishu": { "enabled": true, "aiCommand": "codex" },
    "qq": { "enabled": true, "aiCommand": "codebuddy" }
  }
}
```

### Claude (Agent SDK)

Uses the Agent SDK by default (no local `claude` binary required). Credentials load order:

1. Environment variables  
2. `env` in `~/.open-im/config.json`  
3. `~/.claude/settings.json` or `~/.claude.json`

Third-party compatible endpoints:

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "your-token",
    "ANTHROPIC_BASE_URL": "https://your-api-endpoint",
    "ANTHROPIC_MODEL": "glm-4.7"
  }
}
```

Claude inherits plugins and settings from `~/.claude/settings.json` when present.

### CodeBuddy

```bash
npm install -g @tencent-ai/codebuddy-code
codebuddy login
```

Useful keys: `tools.codebuddy.cliPath`, `tools.codebuddy.skipPermissions`, `tools.codebuddy.timeoutMs`. On Windows, `codebuddy` may resolve to `%AppData%\Roaming\npm\codebuddy.cmd`.

### Example `config.json`

```json
{
  "aiCommand": "claude",
  "tools": {
    "claude": {
      "workDir": "/path/to/project",
      "skipPermissions": true,
      "timeoutMs": 600000
    },
    "codex": {
      "workDir": "/path/to/project",
      "skipPermissions": true,
      "proxy": "http://127.0.0.1:7890"
    },
    "codebuddy": {
      "skipPermissions": true,
      "timeoutMs": 600000
    }
  },
  "platforms": {
    "telegram": { "enabled": true, "botToken": "YOUR_TELEGRAM_BOT_TOKEN" },
    "feishu": { "enabled": false, "appId": "YOUR_FEISHU_APP_ID", "appSecret": "YOUR_FEISHU_APP_SECRET" },
    "qq": { "enabled": false, "appId": "YOUR_QQ_APP_ID", "secret": "YOUR_QQ_APP_SECRET" },
    "wework": { "enabled": false, "corpId": "YOUR_WEWORK_CORP_ID", "secret": "YOUR_WEWORK_SECRET" },
    "dingtalk": {
      "enabled": false,
      "clientId": "YOUR_DINGTALK_CLIENT_ID",
      "clientSecret": "YOUR_DINGTALK_CLIENT_SECRET",
      "cardTemplateId": "YOUR_DINGTALK_AI_CARD_TEMPLATE_ID"
    },
    "workbuddy": { "enabled": false, "accessToken": "", "refreshToken": "", "userId": "" }
  }
}
```

WorkBuddy (WeChat) is easiest via `open-im init` or by editing `~/.open-im/config.json`.

### Environment variables

**General:** `AI_COMMAND`, `CLAUDE_WORK_DIR`, `LOG_DIR`, `LOG_LEVEL`, `HOOK_PORT`, `OPEN_IM_WEB_PORT`, `OPEN_IM_WEB_HOST`, `OPEN_IM_PUBLIC_WEB_URL`, `OPEN_IM_NO_BROWSER`, `OPEN_IM_ALLOW_REMOTE_API`, `OPEN_IM_CORS_ORIGINS`

**AI:** `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL`, `OPENAI_API_KEY`, `CODEX_PROXY`, `CODEBUDDY_CLI_PATH`, `CODEBUDDY_TIMEOUT_MS`, `CODEBUDDY_API_KEY`, `CODEBUDDY_AUTH_TOKEN`

**Platforms:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_PROXY`, `TELEGRAM_ALLOWED_USER_IDS`, `FEISHU_APP_ID`, `FEISHU_APP_SECRET`, `FEISHU_ALLOWED_USER_IDS`, `QQ_BOT_APPID`, `QQ_BOT_SECRET`, `QQ_BOT_SANDBOX`, `QQ_ALLOWED_USER_IDS`, `DINGTALK_CLIENT_ID`, `DINGTALK_CLIENT_SECRET`, `DINGTALK_CARD_TEMPLATE_ID`, `DINGTALK_ALLOWED_USER_IDS`, `WEWORK_CORP_ID`, `WEWORK_SECRET`, `WEWORK_WS_URL`, `WEWORK_ALLOWED_USER_IDS`, `WORKBUDDY_ACCESS_TOKEN`, `WORKBUDDY_REFRESH_TOKEN`, `WORKBUDDY_USER_ID`, `WORKBUDDY_BASE_URL`, `WORKBUDDY_ALLOWED_USER_IDS`

### Platform setup

| Platform | Where to get credentials |
| --- | --- |
| Telegram | [@BotFather](https://t.me/BotFather) |
| Feishu | [Feishu Open Platform](https://open.feishu.cn/) |
| QQ | [QQ Open Platform](https://bot.q.qq.com/) |
| DingTalk | DingTalk Open Platform — enable bot **Stream Mode** |
| WeCom | [WeCom admin](https://work.weixin.qq.com/) |
| WeChat | `open-im init` → WorkBuddy OAuth |

**DingTalk:** Stream Mode (receive) + OpenAPI (send). With `cardTemplateId`, AI assistant streaming cards are used when possible; otherwise plain text. Custom bots and normal groups may only get single text replies. Startup/shutdown notices are not sent to DingTalk.

## Troubleshooting

| Issue | What to try |
| --- | --- |
| Telegram not responding | Check network; set `proxy` / `TELEGRAM_PROXY` |
| QQ cannot connect | Verify bot and `QQ_BOT_APPID` / `QQ_BOT_SECRET` |
| QQ duplicate replies | Upgrade to the latest version |
| Feishu card errors | Use `/mode ask` or `/mode yolo` without card callbacks |
| WeCom no notifications | Send at least one message to the bot first |
| DingTalk cannot reply | Enable Stream Mode; verify credentials |
| DingTalk no streaming | Custom bots: plain text only; set `cardTemplateId` for AI assistant cards |
| Codex `stream disconnected` | Set `tools.codex.proxy` or `CODEX_PROXY` |
| CodeBuddy asks for login | Run `codebuddy login` |
| WorkBuddy / WeChat | Re-run `open-im init`; tokens and binding links expire |

## License

[MIT](LICENSE)
