# open-im

[English](./README.md) · **中文**

多平台 IM 桥接：把 Telegram、飞书、企业微信、钉钉、QQ、微信（WorkBuddy）接到 Claude Code、Codex、CodeBuddy，在手机或聊天里使用 AI 编程助手。

## 功能特性

- **六个 IM 平台** — Telegram、飞书、企业微信、钉钉、QQ、WorkBuddy
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

## Web 控制台

`open-im start` / `open-im dashboard` 在 **`OPEN_IM_WEB_PORT`**（默认 **39282**）提供内置页面与 **`/api/*`**。浏览器打开 **`http://127.0.0.1:39282`** 即可（与 API 同源）。反向代理时可设 **`OPEN_IM_PUBLIC_WEB_URL`**。

**局域网 / 远程：** `export OPEN_IM_WEB_HOST=0.0.0.0` — 首次外网访问可能需一次性登录链接。可选 **`OPEN_IM_ALLOW_REMOTE_API`**、**`OPEN_IM_CORS_ORIGINS`**。

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

会话状态保存在 **`~/.open-im/data/sessions.json`**（按用户，与 IM 聊天记录无关）。

## 配置说明

### 按平台指定 AI

根级 **`aiCommand`** 为默认；用 **`platforms.<name>.aiCommand`** 覆盖：

```json
{
  "aiCommand": "claude",
  "platforms": {
    "telegram": { "enabled": true, "aiCommand": "codex" }
  }
}
```

### Claude（Agent SDK）

无需本地 `claude` 可执行文件。凭证顺序：环境变量 → **`config.json`** 的 **`env`** → **`~/.claude/settings.json`**。

第三方兼容接口示例：

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

### 最小配置结构

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

在 **`platforms`** 下按需补充飞书、QQ、企业微信、钉钉、WorkBuddy。完整模板请用 **`open-im init`**。微信建议 **`open-im init`** 走 WorkBuddy OAuth。

### 环境变量

可在 **`config.json`** 或环境变量中设置；控制台会展示常用项。常见：**`ANTHROPIC_*`**、**`TELEGRAM_BOT_TOKEN`**、**`OPEN_IM_WEB_PORT`**、**`OPEN_IM_WEB_HOST`**，以及各平台的 `*_APP_ID`、`*_SECRET`、`WORKBUDDY_*` 等。

### 隐私

为改进稳定性，可能记录**匿名**运行信息（不含聊天或 prompt 内容）。若需关闭：环境变量 **`OPEN_IM_TELEMETRY=false`**，或 **`config.json`** 中 **`"telemetry": { "enabled": false }`**。

### 平台凭证

| 平台 | 说明 |
| --- | --- |
| Telegram | [@BotFather](https://t.me/BotFather) |
| 飞书 | [开放平台](https://open.feishu.cn/) |
| QQ | [QQ 开放平台](https://bot.q.qq.com/) |
| 钉钉 | 开放平台创建应用，机器人开 **Stream Mode**；可选 **`cardTemplateId`** 走 AI 助理卡片 |
| 企业微信 | [管理后台](https://work.weixin.qq.com/) |
| 微信 | **`open-im init`** → WorkBuddy OAuth |

## 故障排除

| 现象 | 处理 |
| --- | --- |
| Telegram / 网络 | 配置 `proxy` 或 **`TELEGRAM_PROXY`** |
| QQ | 核对 **`QQ_BOT_APPID`**、**`QQ_BOT_SECRET`**；重复回复请升级版本 |
| 飞书卡片 | 未配回调时用 **`/mode ask`** 或 **`/mode yolo`** |
| 企业微信 | 先给机器人发一条消息 |
| 钉钉 | 开启 Stream Mode；自定义机器人可能仅纯文本 |
| Codex 断流 | **`CODEX_PROXY`** 或 **`tools.codex.proxy`** |
| CodeBuddy 登录 | **`codebuddy login`** |
| WorkBuddy / 微信 | 重跑 **`open-im init`**（Token 会过期） |

## License

[MIT](LICENSE)
