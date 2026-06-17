# Platform Configuration

Detailed setup, credentials, and troubleshooting for each IM platform.

## Table of Contents

- [Telegram](#telegram)
- [Feishu (Lark)](#feishu-lark)
- [QQ](#qq)
- [DingTalk](#dingtalk)
- [WeCom (Enterprise WeChat)](#wecom-enterprise-wechat)
- [WeChat via WorkBuddy](#wechat-via-workbuddy)
- [WeChat via ClawBot](#wechat-via-clawbot)

---

## Telegram

**Credential:** Bot token from [@BotFather](https://t.me/BotFather)

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

| Field | Description |
| --- | --- |
| `botToken` | Bot token from BotFather |
| `proxy` | SOCKS5/HTTP proxy (or `TELEGRAM_PROXY` env) |

**Troubleshooting:** Connection issues → set `proxy` or `TELEGRAM_PROXY`.

---

## Feishu (Lark)

**Credential:** [Open Platform](https://open.feishu.cn/) — create an app, enable bot capability.

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

| Field | Description |
| --- | --- |
| `appId` | App ID from Feishu Open Platform |
| `appSecret` | App Secret |
| `cardTemplateId` | Optional — for interactive AI assistant cards |

**Troubleshooting:** Card callbacks not working → use `/mode ask` or `/mode yolo` without card callbacks.

---

## QQ

**Credential:** [QQ Open Platform](https://bot.q.qq.com/) — create a bot, get app ID and secret.

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

| Field | Description |
| --- | --- |
| `appId` | QQ Bot App ID |
| `appSecret` | QQ Bot App Secret |

**Troubleshooting:** Duplicate replies → check `appId`/`appSecret` and update version.

---

## DingTalk

**Credential:** Open Platform — create an app with a bot, enable **Stream Mode**.

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

| Field | Description |
| --- | --- |
| `appKey` | App Key |
| `appSecret` | App Secret |
| `cardTemplateId` | Optional — for AI assistant streaming cards |

**Troubleshooting:** Must enable Stream Mode. Custom bots may be text-only (no cards).

---

## WeCom (Enterprise WeChat)

**Credential:** [Admin console](https://work.weixin.qq.com/) — create a bot application.

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

| Field | Description |
| --- | --- |
| `corpId` | Corporation ID |
| `corpSecret` | Corporation Secret |

**Troubleshooting:** Send the bot a message first to establish a session.

---

## WeChat via WorkBuddy

The easiest way to connect WeChat. Uses WorkBuddy OAuth — no QR code scanning.

**Setup:** Run `open-im init` and follow the prompts. Tokens are saved automatically.

```json
{
  "platforms": {
    "workbuddy": {
      "enabled": true
    }
  }
}
```

| Field | Description |
| --- | --- |
| `enabled` | Set to `true`; credentials are managed by OAuth flow |

**Troubleshooting:** Tokens expire → re-run `open-im init`.

---

## WeChat via ClawBot

Connects to WeChat via the official iLink Bot API (same protocol as `@tencent-weixin/openclaw-weixin`). Supports text, voice, image, file, and video messages.

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

| Field | Default | Description |
| --- | --- | --- |
| `apiUrl` | `https://ilinkai.weixin.qq.com` | iLink API base URL |
| `apiToken` | — | Bot token (auto-set after QR login) |
| `aiCommand` | `claude` | AI backend override |

**Protocol:** POST + JSON body + Bearer token auth. Long-polling via `ilink/bot/getupdates` with `get_updates_buf` cursor.

**Troubleshooting:** Session expires → re-scan QR code via Web UI.

---

## Per-platform AI override

Set `aiCommand` per platform to use a different AI backend:

```json
{
  "platforms": {
    "telegram": { "enabled": true, "aiCommand": "codex", "botToken": "..." }
  }
}
```

Values: `claude` (default), `codex`, `codebuddy`.
