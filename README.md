# open-im

> 你的 AI 编程助手，在微信里。

open-im 把 Claude Code、Codex、CodeBuddy 接入微信客服号（ClawBot）、微信助理（WorkBuddy）、Telegram、飞书、企业微信、钉钉、QQ 机器人。手机发条消息，电脑上就写好代码。

## 为什么用 open-im

- **随时随地** — 通勤、排队、躺沙发上，手机发消息就能让 AI 干活
- **无缝接力** — 和 Claude Code CLI 共享 session，手机聊一半，电脑接着来
- **完整能力** — 流式输出、会话管理、模型切换，全靠聊天命令
- **一个桥接，多个平台** — 同一个 bot 支持 7 个 IM 平台
- **交互式选择** — AI 问"选 1/2/3"时，IM 显示按钮（Telegram/飞书/钉钉）

## 快速开始

```bash
# 安装
npm install -g @wu529778790/open-im

# 启动
open-im start
```

首次启动会自动打开 Web 控制台，引导你完成配置。

### 最小配置

```json
{
  "tools": {
    "claude": { "workDir": "/path/to/project" }
  },
  "platforms": {
    "telegram": { "enabled": true, "botToken": "YOUR_TOKEN" }
  }
}
```

## 平台支持

| 平台 | 流式输出 | 图片 | 交互按钮 | 接入指南 |
|------|---------|------|---------|---------|
| **微信客服号（ClawBot）** | ✅ | ✅ | ❌ | [接入指南](https://www.codebuddy.cn/docs/workbuddy/Claw) |
| **微信助理（WorkBuddy）** | ✅ | ❌ | ❌ | [接入指南](https://www.codebuddy.cn/docs/workbuddy/Claw) |
| Telegram | ✅ | ✅ | ✅ | [Bot 文档](https://core.telegram.org/bots#creating-a-new-bot) |
| 飞书 | ✅ | ✅ | ✅ | [开放平台](https://open.feishu.cn/) |
| QQ 机器人 | ✅ | ✅ | ❌ | [开放平台](https://bot.q.qq.com/) |
| 企业微信 | ✅ | ✅ | ❌ | [管理后台](https://work.weixin.qq.com/) |
| 钉钉机器人 | ⚠️ 部分 | ✅ | ✅ | [开放平台](https://open-dev.dingtalk.com/) |

每个平台可单独配置 AI 后端（`claude` / `codex` / `codebuddy` / `opencode`），默认 `claude`。

## 聊天命令

### 会话管理

| 命令 | 说明 |
|------|------|
| `/help` | 显示所有命令 |
| `/new` | 开启新 AI 会话 |
| `/sessions` | 浏览历史会话 |
| `/resume [序号]` | 恢复会话 |
| `/history [序号]` | 查看对话记录 |
| `/delete <序号>` | 删除会话 |
| `/rename <标题>` | 重命名会话 |
| `/fork [序号]` | 分支会话 |

### 信息查看

| 命令 | 说明 |
|------|------|
| `/models` | 查看可用模型 |
| `/context` | 查看上下文用量 |
| `/plugins` | 查看已安装插件 |
| `/status` | 显示状态信息 |
| `/cd <路径>` / `/pwd` | 切换/查看工作目录 |

### 快捷命令

| 命令 | 说明 |
|------|------|
| `/git commit` | 提交代码 |
| `/git push` | 推送到远程 |
| `/git pull` | 拉取远程更新 |
| `/test` | 运行测试 |
| `/build` | 构建项目 |
| `/review` | 代码审查 |
| `/explain` | 解释项目结构 |

### 权限与确认

Claude 使用 Agent SDK 集成，open-im 默认不替 Claude 做额外的允许/拒绝协议。Claude 需要用户确认时，会按它自己的原生交互语义发问；你在 IM 里回复选项、确认或补充说明即可继续同一个会话。

如果你希望 Claude 也进入自动执行模式，可以在 Web 控制台的 **AI 工具配置 → Claude Code → 跳过 Claude 权限确认** 打开，或在配置文件里设置：

```json
{
  "tools": {
    "claude": {
      "skipPermissions": true
    }
  }
}
```

也可以用环境变量临时覆盖：

```bash
OPEN_IM_SKIP_PERMISSIONS=true open-im start   # 跳过权限确认
OPEN_IM_SKIP_PERMISSIONS=false open-im start  # 使用 Claude 原生确认
```

Codex、CodeBuddy、OpenCode 仍保持原来的自动执行默认行为。

## 会话接力

open-im 和 Claude Code CLI 共享 session 存储。同一目录下，手机和电脑无缝切换：

```bash
# 电脑端
cd /my-project && claude

# 手机端
"帮我修复登录 bug"    # 自动接续同一个 session

# 回到电脑端
claude -c             # 接上手机端的对话
```

> 不能同时使用两端，但无需退出 CLI。只需等待当前操作完成即可切换。

## Web 控制台

`open-im start` 在 `http://127.0.0.1:39282` 提供管理界面：

- 配置所有平台凭证
- 启动/停止桥接服务
- 编辑配置文件
- 首次运行自动弹出设置向导
- 平台卡片支持展开/折叠
- 一键保存并启动

局域网访问：`export OPEN_IM_WEB_HOST=0.0.0.0`

## CLI 命令

| 命令 | 说明 |
|------|------|
| `open-im init` | 交互式配置 |
| `open-im start` | 后台运行 |
| `open-im stop` | 停止服务 |
| `open-im restart` | 重启 |
| `open-im dashboard` | 仅启动 Web 配置服务 |
| `open-im --version` | 查看版本号 |

## 配置

配置文件：`~/.open-im/config.json`

### Claude（Agent SDK）

无需本地 `claude` 可执行文件。支持第三方兼容接口：

```json
{
  "tools": {
    "claude": {
      "env": {
        "ANTHROPIC_AUTH_TOKEN": "your-token",
        "ANTHROPIC_BASE_URL": "https://your-api-endpoint",
        "ANTHROPIC_MODEL": "model-name"
      }
    }
  }
}
```

### 环境变量

- **`ANTHROPIC_*`** — Claude API 配置
- **`TELEGRAM_BOT_TOKEN`** — Telegram Bot Token
- **`OPEN_IM_WEB_PORT`** — Web 控制台端口（默认 39282）
- **`OPEN_IM_WEB_HOST`** — Web 控制台监听地址
- **`OPEN_IM_SENTRY_DSN`** — Sentry 错误追踪（可选）

### 错误追踪

默认启用 Sentry 收集错误日志（不含聊天内容）。关闭：`OPEN_IM_TELEMETRY=false`

## 平台配置详情

详见 [docs/platforms.md](./docs/platforms.md)

## 环境要求

- Node.js >= 20
- 至少配置一个 IM 平台 + AI 凭证

## License

[MIT](LICENSE)
