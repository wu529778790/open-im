# open-im

[English](./README.md) · **中文**

多平台 IM 桥接：把 Telegram、飞书、企业微信、钉钉、QQ、微信（WorkBuddy）接到 Claude Code、Codex、CodeBuddy，在手机或聊天里使用 AI 编程助手。

## 功能特性

- **六个 IM 平台** — 可同时启用多平台
- **三种 AI 后端** — Claude（Agent SDK）、Codex、CodeBuddy
- **按平台指定 AI** — 覆盖默认 `aiCommand`
- **流式输出** — 视平台能力实时回传
- **多媒体** — 图片、文件、语音、视频（因平台而异）
- **会话隔离** — 每用户独立；`/new` 重置会话
- **Web 配置** — 完整仪表盘 **随 npm 包内置**（`web/dist`），由本机 `http://127.0.0.1:39282` **同源**提供
- **聊天命令** — `/help`、`/new`、`/sessions`、`/resume`、`/cd`、`/pwd`、`/status`、`/allow`、`/deny`

## 环境要求

- Node.js ≥ 20
- 至少配置一个 IM 平台
- 所选 AI 工具所需的凭证

## 快速开始

```bash
npx @wu529778790/open-im start
```

或全局安装：

```bash
npm install -g @wu529778790/open-im
open-im start
```

配置文件：`~/.open-im/config.json`

## CLI 命令

| 命令 | 说明 |
| --- | --- |
| `open-im init` | 交互配置，不启动桥接 |
| `open-im start` | 后台运行桥接 |
| `open-im stop` | 停止后台服务 |
| `open-im restart` | 重启 |
| `open-im dev` | 前台调试 |
| `open-im dashboard` | 仅保留本地配置 HTTP 服务（不启动桥接） |

执行 `start` 后，终端会提示 **Web 控制台** 地址（默认 **`http://127.0.0.1:39282`**，与 API 同源）。

## Web 配置

### 内置仪表盘（完整 UI）

发布到 npm 的包内含 **`web/dist`** 构建产物；`open-im start` 或 `open-im dashboard` 在本机 HTTP 服务上提供 **完整 SPA**（概览、平台、AI、JSON、服务启停等）。浏览器打开 **`http://127.0.0.1:<端口>`**（默认端口 **39282**）即可，**Server URL** 与页面同源，一般无需再填。

- 默认控制台地址：本机 **`http://127.0.0.1:39282`**（随 **`OPEN_IM_WEB_PORT`** 变化）
- 若需自定义打开的链接（例如反向代理后的地址），可设置 **`OPEN_IM_PUBLIC_WEB_URL`**

若从源码安装且未执行 `npm run web:build`，可能没有 `web/dist`，此时 **`GET /`** 仅为极简落地页。

### 本机 HTTP 服务

进程监听 **`OPEN_IM_WEB_PORT`**（默认 **39282**）：

- **`GET /`** — 有 `web/dist` 时返回内置仪表盘；否则为极简落地页
- **`/assets/*`** — 内置前端静态资源（有构建产物时）
- **`/api/*`** — JSON API

### 远程访问

从其他机器或 HTTPS 页面访问时：

```bash
export OPEN_IM_WEB_HOST=0.0.0.0
# 可选：受信网络跳过 Cookie 登录（请自行评估风险）
# export OPEN_IM_ALLOW_REMOTE_API=true
# 可选：限制 CORS 来源（逗号分隔）
# export OPEN_IM_CORS_ORIGINS=http://127.0.0.1:39282
```

未绑定 `127.0.0.1` 时，服务端可能打印 **一次性登录链接**（`login_token=…`）。

### 开发 Web 前端（源码仓库）

```bash
npm run web:dev    # Vite；将 /api 代理到 127.0.0.1:39282
npm run web:build  # 构建到 web/dist（`npm publish` 时会随包打入）
```

更多开发说明见 [CLAUDE.md](./CLAUDE.md)、[AGENTS.md](./AGENTS.md)。

## IM 内命令

| 命令 | 说明 |
| --- | --- |
| `/help` | 帮助 |
| `/new` | 新 AI 会话 |
| `/sessions` | 查看历史会话 |
| `/resume <序号>` | 恢复历史会话 |
| `/status` | AI 与会话信息 |
| `/cd <路径>` | 切换工作目录 |
| `/pwd` | 当前目录 |
| `/allow` / `/y` | 同意权限请求 |
| `/deny` / `/n` | 拒绝权限请求 |

## 会话说明

会话保存在 `~/.open-im/data/sessions.json`，与 IM 聊天记录无关。`/new` 创建新会话并归档旧会话。使用 `/sessions` 查看历史，`/resume <序号>` 恢复之前的会话。

## 配置说明

### 按平台分配 AI

根级 `aiCommand` 为默认；用 `platforms.<name>.aiCommand` 覆盖：

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

### Claude（Agent SDK）

默认使用 Agent SDK，无需本地 `claude` 可执行文件。凭证顺序：环境变量 → `config.json` 的 `env` → `~/.claude/settings.json` / `~/.claude.json`。

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

会继承 `~/.claude/settings.json` 中的插件等配置。

### CodeBuddy

```bash
npm install -g @tencent-ai/codebuddy-code
codebuddy login
```

常用项：`tools.codebuddy.cliPath`、`skipPermissions`、`timeoutMs`。Windows 下可能解析到 `%AppData%\Roaming\npm\codebuddy.cmd`。

### 配置示例

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

微信（WorkBuddy）建议用 `open-im init` 或直接编辑 `~/.open-im/config.json`。

### 环境变量

**通用：** `AI_COMMAND`、`CLAUDE_WORK_DIR`、`LOG_DIR`、`LOG_LEVEL`、`HOOK_PORT`、`OPEN_IM_WEB_PORT`、`OPEN_IM_WEB_HOST`、`OPEN_IM_PUBLIC_WEB_URL`、`OPEN_IM_NO_BROWSER`、`OPEN_IM_ALLOW_REMOTE_API`、`OPEN_IM_CORS_ORIGINS`

**AI：** `ANTHROPIC_API_KEY`、`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_BASE_URL`、`ANTHROPIC_MODEL`、`OPENAI_API_KEY`、`CODEX_PROXY`、`CODEBUDDY_CLI_PATH`、`CODEBUDDY_TIMEOUT_MS`、`CODEBUDDY_API_KEY`、`CODEBUDDY_AUTH_TOKEN`

**平台：** `TELEGRAM_BOT_TOKEN`、`TELEGRAM_PROXY`、`TELEGRAM_ALLOWED_USER_IDS`、`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_ALLOWED_USER_IDS`、`QQ_BOT_APPID`、`QQ_BOT_SECRET`、`QQ_BOT_SANDBOX`、`QQ_ALLOWED_USER_IDS`、`DINGTALK_CLIENT_ID`、`DINGTALK_CLIENT_SECRET`、`DINGTALK_CARD_TEMPLATE_ID`、`DINGTALK_ALLOWED_USER_IDS`、`WEWORK_CORP_ID`、`WEWORK_SECRET`、`WEWORK_WS_URL`、`WEWORK_ALLOWED_USER_IDS`、`WORKBUDDY_ACCESS_TOKEN`、`WORKBUDDY_REFRESH_TOKEN`、`WORKBUDDY_USER_ID`、`WORKBUDDY_BASE_URL`、`WORKBUDDY_ALLOWED_USER_IDS`

### 平台凭证来源

| 平台 | 说明 |
| --- | --- |
| Telegram | [@BotFather](https://t.me/BotFather) |
| 飞书 | [飞书开放平台](https://open.feishu.cn/) |
| QQ | [QQ 开放平台](https://bot.q.qq.com/) |
| 钉钉 | 开放平台创建应用，启用机器人 **Stream Mode** |
| 企业微信 | [管理后台](https://work.weixin.qq.com/) |
| 微信 | `open-im init` 选择 WorkBuddy 完成 OAuth |

**钉钉：** Stream 收消息 + OpenAPI 发消息；配置 `cardTemplateId` 可用 AI 助理流式卡片，失败则回退纯文本；自定义机器人与普通群可能仅支持单条文本；启停通知不会发到钉钉。

## 故障排除

| 现象 | 处理 |
| --- | --- |
| Telegram 无响应 | 检查网络；配置 `proxy` / `TELEGRAM_PROXY` |
| QQ 连不上 | 核对机器人与 `QQ_BOT_APPID`、`QQ_BOT_SECRET` |
| QQ 重复回复 | 升级到最新版 |
| 飞书卡片报错 | 未配回调时用 `/mode ask` 或 `/mode yolo` |
| 企业微信无通知 | 先给机器人发一条消息 |
| 钉钉无法回复 | 开启 Stream Mode；核对凭证 |
| 钉钉无流式 | 自定义机器人多为纯文本；配 `cardTemplateId` 走 AI 助理卡片 |
| Codex `stream disconnected` | 配置 `tools.codex.proxy` 或 `CODEX_PROXY` |
| CodeBuddy 要登录 | 先 `codebuddy login` |
| WorkBuddy / 微信 | 重跑 `open-im init`；Token 与绑定链接会过期 |

## License

[MIT](LICENSE)
