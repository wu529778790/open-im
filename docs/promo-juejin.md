# 把手机里的 IM 变成「远程 AI 编程台」：开源项目 open-im 介绍

> 一句话：**用 Telegram、飞书、企微、钉钉、QQ、微信 WorkBuddy 等聊天窗口，连上本机的 Claude Code / Codex / CodeBuddy**，出门在外也能让 AI 改代码、跑任务。

---

## 解决了什么问题？

很多开发者已经习惯在终端里用 **Claude Code、Codex、CodeBuddy** 做日常开发，但：

- 不在电脑旁时，没法顺手丢一句需求给 AI；
- 团队里有人更习惯 **飞书 / 钉钉 / 企微**，希望「对话即工单」；
- 不想维护一堆零散脚本，只想 **一个进程 + 一份配置** 把 IM 和 AI CLI 串起来。

**open-im** 就是一个 **Node.js 单进程桥接**：各 IM 平台作为入口，背后统一走你配置的 AI 工具与工作目录，支持流式回复、会话管理、内置 Web 控制台。

---

## 核心亮点（节选）

| 维度 | 说明 |
|------|------|
| **多 IM** | Telegram、飞书、企业微信、钉钉、QQ、WorkBuddy（微信客服链路）等，可按需启用 |
| **多 AI 后端** | Claude（Agent SDK）、Codex、CodeBuddy；**可按平台**指定 `aiCommand` |
| **自带仪表盘** | 内置 Web 配置与状态，默认 `http://127.0.0.1:39282`，无需另起一套前端项目 |
| **会话与命令** | `/new`、`/sessions`、`/status`、`/cd` 等，会话持久化在本地数据目录 |
| **部署简单** | 无数据库、无 Redis，**配置 + API 密钥** 即可跑 |

---

## 适合谁？

- 想 **手机 / 平板上** 触发本机 AI 写代码、查仓库的开发者；
- 在 **国内 IM**（飞书、钉钉、企微）里做 **运维 / 协作机器人** 原型；
- 已经重度使用 **Claude Code / Codex / CodeBuddy**，希望 **统一入口** 的同学。

---

## 快速体验

环境：**Node.js ≥ 20**，并准备好至少一个 IM 平台凭证 + 所选 AI 的密钥。

```bash
npx @wu529778790/open-im start
```

或全局安装后：

```bash
npm install -g @wu529778790/open-im
open-im init    # 交互式配置（可选）
open-im start   # 后台启动桥接
```

配置文件路径：**`~/.open-im/config.json`**。也可用 **`open-im dashboard`** 单独拉起 Web 配置页（不启动完整桥接）。

---

## 项目信息

- **npm 包页**：<https://www.npmjs.com/package/@wu529778790/open-im>（包名 `@wu529778790/open-im`）
- **源码与文档**：仓库内 [README.md](../README.md)、[README.zh-CN.md](../README.zh-CN.md)（含按平台配置、远程访问与安全提示）

若你觉得「IM + 本地 AI CLI」这条路线有用，欢迎 **Star / Issue / PR** 一起把更多平台和使用场景打磨顺。
