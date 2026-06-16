# Open-IM 面试项目介绍指南

> 定位：AI Agent 方向面试，着重介绍本项目的架构设计、Agent 集成方式和工程能力。

## 一句话概括

我做了一个 AI Agent 的多平台接入层，把 6 个 IM 平台（Telegram、飞书、企业微信、钉钉、QQ、WorkBuddy）桥接到 3 种 AI 编程工具（Claude Code、Codex、CodeBuddy），用户在手机聊天窗口就能远程使用 AI 编程助手。项目有 600+ 次提交、约 28000 行 TypeScript。

## 核心亮点

### 1. Agent SDK 进程内集成 + 会话池管理

不是 `spawn` 子进程调 CLI，而是直接用 Claude Agent SDK 的 `v2 Session API` 在进程内执行 Agent。

**为什么这样做：**

- 零 fork 开销，响应更快
- 可以直接拿到流式事件（text delta、thinking、tool_use）
- 会话状态在内存中保持，支持真正的多轮对话

**关键实现：**

- `Map<sessionId, SDKSession>` 会话池，上限 100 个
- 空闲 30 分钟自动清理，`runningSessions` 集合保护长任务不被误杀
- `chdirMutex` 互斥锁：因为 SDK 的 `process.chdir()` 是全局副作用，并发场景下会竞态，用互斥锁保证同一时刻只有一个 Agent 在切换目录
- 临时 `pending-*` ID 在收到 init 消息的真实 sessionId 后完成映射替换

**相关文件：** `src/adapters/claude-sdk-adapter.ts`

### 2. 适配器模式 + 注册表，一套接口接三个 AI 后端

定义了 `ToolAdapter` 接口，三个后端各自实现，上层代码完全不关心底层是哪个 AI。

**接口设计：**

```typescript
interface ToolAdapter {
  readonly toolId: string;
  run(prompt, sessionId, workDir, callbacks, options): RunHandle;
}

interface RunCallbacks {
  onText(delta: string): void;        // 流式文本增量
  onThinking(delta: string): void;     // 思考过程
  onToolUse(name: string, input: any): void;  // 工具调用通知
  onComplete(result: ParsedResult): void;     // 完成
  onError(error: Error): void;         // 错误
  onSessionInvalid(): void;            // 会话失效
}
```

**运行时行为：**

- 根据 `config.json` 中的 `aiCommand` 动态实例化对应适配器
- 支持按平台覆盖（比如 Telegram 走 Codex，飞书走 Claude）
- `registry.ts` 负责统一生命周期管理

**相关文件：** `src/adapters/tool-adapter.interface.ts`、`src/adapters/registry.ts`

### 3. 流式响应的双重节流

AI 输出是逐 token 的，但 IM 平台不支持真正的流式推送。需要在"实时感"和"不刷爆 API 限流"之间找平衡。

**策略：**

- **时间节流**：`throttleMs` 控制最小更新间隔
- **内容节流**：`minContentDeltaChars` 控制最小内容增量
- **debounce 150ms**：最后一次更新延迟发送，确保内容完整
- **`onThinkingToText`**：模型从思考阶段过渡到输出阶段时平滑过渡，避免内容跳变

**相关文件：** `src/shared/ai-task.ts`

### 4. 请求队列与并发控制

**设计目标：** 同一用户的 AI 请求不能并发（会话冲突、目录切换等），但不同用户可以并行。

**实现：**

- 按 `userId` 分区，每个用户一个 FIFO 队列
- 队列深度上限 3，超出拒绝入队
- `AbortController` 管理生命周期
- `cancelUser()` 用于 `/new`、`/cd` 等场景——中止当前任务并清空队列，防止过期响应覆盖新对话

**相关文件：** `src/queue/request-queue.ts`

### 5. 会话持久化与恢复

**功能：**

- 每个用户维护独立的会话状态（`UserSession`）
- 最多 10 条历史会话栈，`/resume` 可恢复任意历史会话
- 工作目录切换时自动归档当前会话并创建新 convId

**持久化安全：**

- 原子写入：先写 `.tmp` 再 `rename`，防止写坏
- 500ms 防抖保存，避免高频 IO
- v1 → v2 数据格式自动迁移

**相关文件：** `src/session/session-manager.ts`

## 架构总览

```
IM Platforms (6个)          Core Services           AI Adapters         AI Tools
┌─────────────────┐    ┌───────────────────┐    ┌─────────────────┐    ┌──────────┐
│ Telegram        │    │ Event Handlers    │    │ Claude SDK      │───▶│Claude Code│
│ Feishu          │───▶│ Request Queue     │───▶│ Codex Adapter   │───▶│Codex CLI  │
│ WeCom           │    │ Access Control    │    │ CodeBuddy Adapt.│───▶│CodeBuddy  │
│ DingTalk        │    │ Message Dedup     │    └─────────────────┘    └──────────┘
│ QQ              │    └───────────────────┘           ▲
│ WorkBuddy       │            │                      │
└─────────────────┘    ┌───────────────────┐    Adapter Registry
                       │ Session Manager   │    (动态实例化)
                       └───────────────────┘
```

**分层设计：**

- **平台层**：每个 IM 平台独立实现 client + event-handler + message-sender，新增平台只需三个文件
- **核心服务层**：事件处理、请求队列、权限控制、消息去重，通过 Bus 模式与平台层解耦
- **适配器层**：统一的 ToolAdapter 接口，运行时根据配置动态选择
- **存储层**：config.json + sessions.json + logs

## 面试 Q&A 准备

### 为什么用 Agent SDK 而不是 spawn CLI？

进程内执行没有 fork 开销；可以直接拿到流式事件（text delta、thinking、tool_use）；会话状态在内存中保持，不用每次重新初始化上下文。传统 CLI wrapper 每次调用都是冷启动，Agent SDK 可以做真正的持久会话。

### 并发怎么处理的？

四个层面：按用户串行化（Request Queue）、会话池上限 100、chdirMutex 互斥锁解决全局副作用、AbortController 管理生命周期。用户发 `/new` 时 cancelUser() 会中止当前任务并清空队列。

### 流式响应怎么做的？

双重节流——时间间隔 + 内容增量，配合 debounce。IM 平台支持原地编辑消息，所以每累积足够内容就更新一次消息，实现伪流式效果。

### 会话管理有哪些难点？

多用户隔离（每个 userId 独立状态）、历史恢复（10 条会话栈 + /resume）、工作目录切换时自动归档、持久化的原子写入（防写坏）、数据格式迁移。

### 错误处理怎么做的？

错误分类为 7 种（aborted/limit/auth/model/process/network/unknown），用于遥测分析。会话失效时自动清除旧会话并创建新会话。最终消息发送带重试机制。

### 新增一个 IM 平台要改多少代码？

只需要三个文件：client.ts（平台 SDK 初始化）、event-handler.ts（消息/命令路由）、message-sender.ts（回复发送）。核心服务层和适配器层完全不用动。

## 开场话术（30 秒）

> 这个项目的核心是一个 AI Agent 的多平台接入网关。技术上最关键的是用 Claude Agent SDK 做了进程内的 Agent 编排，而不是传统的 CLI wrapper——这样零 fork 开销、可以直接拿到流式事件、支持真正的多轮持久会话。同时设计了一套统一的适配器接口，让 Claude、Codex、CodeBuddy 三个 AI 后端可以无缝切换，运行时按配置动态选择。
