# open-im

[English](./README.md) · **中文**

多平台 IM 桥接：把 Telegram、飞书、企业微信、钉钉、QQ、微信（WorkBuddy）、微信（ClawBot）接到 Claude Code、Codex、CodeBuddy，在手机或聊天里使用 AI 编程助手。

## 架构

![Open-IM 架构图](./diagram/architecture/open-im-architecture.svg)

## 功能特性

- **七个 IM 平台** — Telegram、飞书、企业微信、钉钉、QQ、WorkBuddy、ClawBot
- **三种 AI 后端** — Claude（Agent SDK）、Codex、CodeBuddy（可按平台覆盖）
- **流式、多媒体、会话** — 视平台能力；`/new` 开启新 AI 会话
- **Web 控制台** — 随包内置，默认 **`http://127.0.0.1:39282`**

## 环境要求

- Node.js ≥ 20
- 至少配置一个 IM 平台 + 所选 AI 的凭证

## 快速开始

```bash
npx @wu529778790/open-im start
```

或：`npm install -g @wu529778790/open-im` 后执行 `open-im start`。

配置：**`~/.open-im/config.json`**

## CLI 命令

| 命令 | 说明 |
| --- | --- |
| `open-im init` | 交互配置（不启动桥接） |
| `open-im start` | 后台运行桥接 |
| `open-im stop` | 停止后台服务 |
| `open-im restart` | 重启 |
| `open-im dashboard` | 仅 Web 配置服务（不启动桥接） |

`start` 后会提示控制台地址（默认 **`http://127.0.0.1:39282`**）。

## IM 内命令

| 命令 | 说明 |
| --- | --- |
| `/help` | 帮助 |
| `/new` | 新 AI 会话 |
| `/sessions` | 历史会话 |
| `/resume <序号>` | 按列表序号恢复 |
| `/status` | AI 与会话信息 |
| `/cd` / `/pwd` | 工作目录 |
| `/allow` / `/y`、`/deny` / `/n` | 权限确认 |

## 会话接力

open-im 和 Claude Code CLI 共享同一份 session 存储。在同一个目录下，手机和电脑可以无缝切换。

**手机接电脑：** open-im 自动恢复同目录下最新的 CLI session，无需配置。

**电脑接手机：** 使用 `claude --continue`（或 `claude -c`）接上 open-im 端的对话。

```bash
# 电脑端
cd /my-project && claude        # 正常工作，退出时 Ctrl+C

# 手机端（IM 消息）
"帮我修复登录 bug"              # open-im 自动接续同一个 session

# 回到电脑端
claude -c                       # 接上手机端的对话
```

> 同一时刻只能有一端活跃。从手机发消息前先退出 CLI，反之亦然。

## Git 共同作者

默认在 AI 发起的提交里追加 `Co-authored-by`。**关闭**：设置环境变量 **`OPEN_IM_GIT_COAUTHOR=0`** 并重启桥接。

## 最小配置

```json
{
  "tools": {
    "claude": { "workDir": "/path/to/project", "skipPermissions": true, "timeoutMs": 600000 }
  },
  "platforms": {
    "telegram": { "enabled": true, "botToken": "YOUR_TELEGRAM_BOT_TOKEN" }
  }
}
```

在 **`platforms`** 下按需补充其他平台。完整模板请用 **`open-im init`**。

### Claude（Agent SDK）

无需本地 `claude` 可执行文件。第三方兼容接口示例：

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

### 按平台指定 AI

在每个平台上设置 **`platforms.<name>.aiCommand`**（`claude` / `codex` / `codebuddy`）。默认 `claude`。

### Web 控制台

`open-im start` 在 **`OPEN_IM_WEB_PORT`**（默认 **39282**）提供内置页面与 **`/api/*`**。局域网访问：`export OPEN_IM_WEB_HOST=0.0.0.0`。

### 环境变量

常见：**`ANTHROPIC_*`**（shell 或 **`tools.claude.env`**）、**`TELEGRAM_BOT_TOKEN`**、**`OPEN_IM_WEB_PORT`**、**`OPEN_IM_WEB_HOST`**，以及各平台的 `*_APP_ID`、`*_SECRET`、`WORKBUDDY_*` 等。

### 隐私

为改进稳定性，可能记录**匿名**运行信息（不含聊天或 prompt 内容）。若需关闭：环境变量 **`OPEN_IM_TELEMETRY=false`**，或 **`config.json`** 中 **`"telemetry": { "enabled": false }`**。

## 平台配置与故障排除

详见 **[docs/platforms.zh-CN.md](./docs/platforms.zh-CN.md)**。

## License

[MIT](LICENSE)
