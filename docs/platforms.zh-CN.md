# 平台配置

各 IM 平台的详细配置、凭证获取与故障排除。

## 目录

- [Telegram](#telegram)
- [飞书](#飞书)
- [QQ](#qq)
- [钉钉](#钉钉)
- [企业微信](#企业微信)
- [微信（WorkBuddy）](#微信workbuddy)
- [微信（ClawBot）](#微信clawbot)

---

## Telegram

**凭证：** [@BotFather](https://t.me/BotFather) 获取 Bot Token

```json
{
  "platforms": {
    "telegram": {
      "enabled": true,
      "botToken": "YOUR_TELEGRAM_BOT_TOKEN"
    }
  }
}
```

| 字段 | 说明 |
| --- | --- |
| `botToken` | BotFather 提供的 Bot Token |
| `proxy` | SOCKS5/HTTP 代理（或 `TELEGRAM_PROXY` 环境变量） |

**故障排除：** 连接问题 → 配置 `proxy` 或 `TELEGRAM_PROXY`。

---

## 飞书

**凭证：** [开放平台](https://open.feishu.cn/) 创建应用，开启机器人能力。

```json
{
  "platforms": {
    "feishu": {
      "enabled": true,
      "appId": "YOUR_APP_ID",
      "appSecret": "YOUR_APP_SECRET"
    }
  }
}
```

| 字段 | 说明 |
| --- | --- |
| `appId` | 飞书开放平台 App ID |
| `appSecret` | App Secret |
| `cardTemplateId` | 可选 — 互动卡片模板 ID |

**故障排除：** 卡片回调不生效 → 用 `/mode ask` 或 `/mode yolo` 不走卡片回调。

---

## QQ

**凭证：** [QQ 开放平台](https://bot.q.qq.com/) 创建机器人，获取 App ID 和 Secret。

```json
{
  "platforms": {
    "qq": {
      "enabled": true,
      "appId": "YOUR_QQ_APP_ID",
      "appSecret": "YOUR_QQ_APP_SECRET"
    }
  }
}
```

| 字段 | 说明 |
| --- | --- |
| `appId` | QQ 机器人 App ID |
| `appSecret` | QQ 机器人 App Secret |

**故障排除：** 重复回复 → 核对 `appId`/`appSecret`，升级版本。

---

## 钉钉

**凭证：** 开放平台创建应用，添加机器人，开启 **Stream Mode**。

```json
{
  "platforms": {
    "dingtalk": {
      "enabled": true,
      "appKey": "YOUR_APP_KEY",
      "appSecret": "YOUR_APP_SECRET"
    }
  }
}
```

| 字段 | 说明 |
| --- | --- |
| `appKey` | 应用 App Key |
| `appSecret` | 应用 App Secret |
| `cardTemplateId` | 可选 — AI 助理流式卡片模板 |

**故障排除：** 必须开启 Stream Mode。自定义机器人可能仅支持纯文本。

---

## 企业微信

**凭证：** [管理后台](https://work.weixin.qq.com/) 创建机器人应用。

```json
{
  "platforms": {
    "wework": {
      "enabled": true,
      "corpId": "YOUR_CORP_ID",
      "corpSecret": "YOUR_CORP_SECRET"
    }
  }
}
```

| 字段 | 说明 |
| --- | --- |
| `corpId` | 企业 ID |
| `corpSecret` | 应用 Secret |

**故障排除：** 先给机器人发一条消息建立会话。

---

## 微信（WorkBuddy）

最简单的微信接入方式，使用 WorkBuddy OAuth，无需扫码。

**配置：** 运行 `open-im init` 按提示操作，Token 自动保存。

```json
{
  "platforms": {
    "workbuddy": {
      "enabled": true
    }
  }
}
```

| 字段 | 说明 |
| --- | --- |
| `enabled` | 设为 `true`；凭证由 OAuth 流程管理 |

**故障排除：** Token 过期 → 重新运行 `open-im init`。

---

## 微信（ClawBot）

通过官方 iLink Bot API 连接微信（与 `@tencent-weixin/openclaw-weixin` 协议相同）。支持文本、语音、图片、文件和视频消息。

**使用方法：**

1. 在配置中启用：
   ```json
   {
     "platforms": {
       "clawbot": { "enabled": true }
     }
   }
   ```
2. 打开 Web 控制台 → **ClawBot** 区域 → **扫码登录**（用微信扫码）。
3. 扫码成功后 `bot_token` 和 `apiUrl` 自动保存。

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `apiUrl` | `https://ilinkai.weixin.qq.com` | iLink API 地址 |
| `apiToken` | — | Bot Token（扫码后自动写入） |
| `aiCommand` | `claude` | AI 后端覆盖 |

**协议：** POST + JSON body + Bearer token 鉴权，通过 `ilink/bot/getupdates` 长轮询 + `get_updates_buf` 游标拉取消息。

**故障排除：** 会话过期 → Web 控制台重新扫码。

---

## 按平台指定 AI

在每个平台上设置 `aiCommand` 可使用不同的 AI 后端：

```json
{
  "platforms": {
    "telegram": { "enabled": true, "aiCommand": "codex", "botToken": "..." }
  }
}
```

可选值：`claude`（默认）、`codex`、`codebuddy`。
