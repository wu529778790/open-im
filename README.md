# open-im

**English** · [中文](./README.zh-CN.md)

> Your AI coding assistant, in every chat app.

open-im bridges Claude Code, Codex, and CodeBuddy to Telegram, Feishu, WeCom, DingTalk, QQ, WeChat (WorkBuddy), and WeChat (ClawBot). Send a message from your phone, get code written on your server.

## Architecture

![Open-IM Architecture](./diagram/architecture/open-im-architecture.svg)

## Why

- **Work from anywhere** — trigger Claude Code from your phone while commuting, waiting in line, or on the couch
- **Seamless handoff** — open-im shares sessions with the Claude Code CLI; pick up on your computer exactly where you left off on your phone
- **Full power, simple interface** — stream responses, manage sessions, switch models — all through chat commands
- **One bridge, many platforms** — same bot works on Telegram, Feishu, DingTalk, WeChat, and more

## Features

### Chat commands

| Command | Description |
| --- | --- |
| `/help` | Show all commands |
| `/new` | Start a fresh AI session |
| `/sessions` | Browse session history with previews |
| `/resume [N]` | Resume a session (no arg = most recent) |
| `/history [N]` | View conversation messages in a session |
| `/delete <N>` | Delete a session |
| `/rename <title>` | Rename the current session |
| `/fork [N]` | Fork a session (create a branch) |
| `/models` | List available AI models |
| `/context` | Show context window usage |
| `/status` | Show AI tool, account, and session info |
| `/cd <path>` / `/pwd` | Switch work directory (auto-resumes that dir's session) |
| `/allow` / `/y`, `/deny` / `/n` | Respond to permission prompts |

### Session continuity

open-im and Claude Code CLI share the same session storage. In the same directory, you can seamlessly switch between phone and computer.

```
# On computer
cd /my-project && claude        # work as usual, then Ctrl+C

# On phone (via IM)
"help me fix the login bug"     # open-im auto-resumes the same session

# Back on computer
claude -c                       # continues the phone conversation
```

> Only one side can be active at a time. Exit the CLI before sending messages from the phone, and vice versa.

### Platform support

Seven IM platforms, three AI backends, per-platform override:

| Platform | Streaming | Media | Notes |
| --- | --- | --- | --- |
| Telegram | Yes | Images | Full bot support |
| Feishu | Yes | Images | Streaming card |
| WeCom | Yes | Images | Streaming card |
| DingTalk | Partial | Images | Fallback to text |
| QQ | Yes | Images | |
| WorkBuddy | Yes | Images | WeChat-based |
| ClawBot | Yes | Images | WeChat-based |

Set `platforms.<name>.aiCommand` (`claude` / `codex` / `codebuddy`) per channel. Default: `claude`.

### Web dashboard

`open-im start` serves a built-in SPA and API at **`http://127.0.0.1:39282`** (configurable via `OPEN_IM_WEB_PORT`). For LAN access: `export OPEN_IM_WEB_HOST=0.0.0.0`.

## Quick start

```bash
npx @wu529778790/open-im init    # interactive setup
npx @wu529778790/open-im start   # run the bridge
```

Or install globally: `npm install -g @wu529778790/open-im` then `open-im start`.

Config file: **`~/.open-im/config.json`**

### Minimal config

```json
{
  "tools": {
    "claude": { "workDir": "/path/to/project", "skipPermissions": true }
  },
  "platforms": {
    "telegram": { "enabled": true, "botToken": "YOUR_TELEGRAM_BOT_TOKEN" }
  }
}
```

Run `open-im init` for a full template with all platforms.

### Claude (Agent SDK)

No local `claude` binary required. Supports third-party / compatible APIs:

```json
{
  "tools": {
    "claude": {
      "env": {
        "ANTHROPIC_AUTH_TOKEN": "your-token",
        "ANTHROPIC_BASE_URL": "https://your-api-endpoint",
        "ANTHROPIC_MODEL": "glm-4.7"
      }
    }
  }
}
```

### CLI reference

| Command | Description |
| --- | --- |
| `open-im init` | Interactive setup (does not start the bridge) |
| `open-im start` | Run the bridge in the background |
| `open-im stop` | Stop the background bridge |
| `open-im restart` | Stop then start |
| `open-im dashboard` | Web config server only (no bridge) |

### Environment variables

**`ANTHROPIC_*`** (shell or `tools.claude.env`), **`TELEGRAM_BOT_TOKEN`**, **`OPEN_IM_WEB_PORT`**, **`OPEN_IM_WEB_HOST`**, plus platform-specific `*_APP_ID`, `*_SECRET`, `WORKBUDDY_*`, etc.

### Git co-authors

`Co-authored-by` is appended by default on AI-driven commits. Disable: set **`OPEN_IM_GIT_COAUTHOR=0`** in the environment and restart the bridge.

### Privacy

**Anonymous** usage information may be collected to improve reliability (no chat or prompt content). To disable: **`OPEN_IM_TELEMETRY=false`** or `"telemetry": { "enabled": false }` in `config.json`.

## Platform setup & troubleshooting

See **[docs/platforms.md](./docs/platforms.md)** for detailed per-platform configuration, credential setup, and troubleshooting.

## Requirements

- Node.js >= 20
- At least one IM platform configured + credentials for your AI tool

## License

[MIT](LICENSE)
