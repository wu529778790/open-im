# open-im

[English](./README.md) · **中文**

> 你的 AI 编程助手，在每个聊天 App 里。

open-im 把 Claude Code、Codex、CodeBuddy 接入 Telegram、飞书、企业微信、钉钉、QQ、微信（WorkBuddy）、微信（ClawBot）。手机发条消息，服务器上就写好代码。

## 架构

![Open-IM 架构图](./diagram/architecture/open-im-architecture.svg)

## 为什么用 open-im

- **随时随地** — 通勤、排队、躺沙发上，手机发消息就能让 Claude Code 干活
- **无缝接力** — open-im 和 Claude Code CLI 共享 session，在手机上聊到一半，电脑上接着来
- **完整能力，简单界面** — 流式输出、会话管理、模型切换，全靠聊天命令搞定
- **一个桥接，多个平台** — 同一个 bot 支持 Telegram、飞书、钉钉、微信等

## 功能

### 聊天命令

| 命令 | 说明 |
| --- | --- |
| `/help` | 显示所有命令 |
| `/new` | 开启新 AI 会话 |
| `/sessions` | 浏览历史会话（含摘要预览） |
| `/resume [序号]` | 恢复会话（无参数恢复最近一条） |
| `/history [序号]` | 查看会话对话记录 |
| `/delete <序号>` | 删除历史会话 |
| `/rename <标题>` | 重命名当前会话 |
| `/fork [序号]` | 分支会话（创建副本） |
| `/models` | 查看可用 AI 模型 |
| `/context` | 查看上下文窗口占用 |
| `/status` | 显示 AI 工具、账号、会话信息 |
| `/cd <路径>` / `/pwd` | 切换工作目录（自动恢复该目录的历史会话） |
| `/allow` / `/y`、`/deny` / `/n` | 权限确认 |

### 会话接力

open-im 和 Claude Code CLI 共享同一份 session 存储。同一个目录下，手机和电脑可以无缝切换。

```bash
# 电脑端
cd /my-project && claude        # 正常工作，退出时 Ctrl+C

# 手机端（IM 消息）
"帮我修复登录 bug"              # open-im 自动接续同一个 session

# 回到电脑端
claude -c                       # 接上手机端的对话
```

> 同一时刻只能有一端活跃。从手机发消息前先退出 CLI，反之亦然。

### 平台支持

七个 IM 平台，三种 AI 后端，可按平台覆盖：

| 平台 | 流式输出 | 备注 |
| --- | --- | --- |
| Telegram | 支持 | 完整 bot 支持 |
| 飞书 | 支持 | 流式卡片 |
| 企业微信 | 支持 | 流式卡片 |
| 钉钉 | 部分 | 回退到纯文本 |
| QQ | 支持 | |
| WorkBuddy | 支持 | 微信生态 |
| ClawBot | 支持 | 微信生态 |

在每个平台上设置 `platforms.<name>.aiCommand`（`claude` / `codex` / `codebuddy`），默认 `claude`。

### Web 控制台

`open-im start` 在 **`http://127.0.0.1:39282`** 提供内置页面与 API（通过 `OPEN_IM_WEB_PORT` 配置端口）。局域网访问：`export OPEN_IM_WEB_HOST=0.0.0.0`。

## 快速开始

```bash
npx @wu529778790/open-im init    # 交互式配置
npx @wu529778790/open-im start   # 启动桥接
```

或全局安装：`npm install -g @wu529778790/open-im` 后执行 `open-im start`。

配置文件：**`~/.open-im/config.json`**

### 最小配置

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

完整模板请用 `open-im init`。

### Claude（Agent SDK）

无需本地 `claude` 可执行文件。支持第三方兼容接口：

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

### CLI 命令

| 命令 | 说明 |
| --- | --- |
| `open-im init` | 交互配置（不启动桥接） |
| `open-im start` | 后台运行桥接 |
| `open-im stop` | 停止后台服务 |
| `open-im restart` | 重启 |
| `open-im dashboard` | 仅 Web 配置服务（不启动桥接） |

### 环境变量

**`ANTHROPIC_*`**（shell 或 `tools.claude.env`）、**`TELEGRAM_BOT_TOKEN`**、**`OPEN_IM_WEB_PORT`**、**`OPEN_IM_WEB_HOST`**，以及各平台的 `*_APP_ID`、`*_SECRET`、`WORKBUDDY_*` 等。

### Git 共同作者

默认在 AI 发起的提交里追加 `Co-authored-by`。关闭：设置环境变量 **`OPEN_IM_GIT_COAUTHOR=0`** 并重启桥接。

### 隐私

为改进稳定性，可能记录**匿名**运行信息（不含聊天或 prompt 内容）。若需关闭：环境变量 **`OPEN_IM_TELEMETRY=false`**，或 `config.json` 中 `"telemetry": { "enabled": false }`。

## 平台配置与故障排除

详见 **[docs/platforms.zh-CN.md](./docs/platforms.zh-CN.md)**。

## 环境要求

- Node.js >= 20
- 至少配置一个 IM 平台 + 所选 AI 的凭证

## License

[MIT](LICENSE)
