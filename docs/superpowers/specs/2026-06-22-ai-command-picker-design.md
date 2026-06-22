# AI 工具字段置顶设计（AI Command Picker）

## 背景与动机

open-im 的每个 IM 渠道（Telegram / 飞书 / QQ / 企业微信 / 钉钉 / WorkBuddy / ClawBot）独立配置回复用的 AI 工具（`aiCommand`：claude / opencode / codex / codebuddy）。但当前 UI 把 `aiCommand` 下拉框**和 apiToken、apiUrl 等凭证字段平级渲染**在平台卡片表单中部，用户很难意识到：

1. 每个渠道的 AI 工具是独立配置的；
2. 自己当前改的是哪个渠道；
3. "扫码登录"只配了凭证，AI 工具静默用了默认值 `claude`（参见 `empty-payload.ts`）。

实际用户反馈：在 WorkBuddy 卡片把 AI 改成 opencode，但从 ClawBot 渠道发消息时仍是 claude，完全不知道两个渠道各自独立。这是产品心智模型未被 UI 传达的典型问题。

## 目标

让"这个渠道用什么 AI 回复"成为平台卡片里**视觉层级最高**的字段，用户展开卡片一眼可见，降低"不知道 AI 工具是按渠道独立配置"的认知负担。

**非目标**（本轮不做）：

- 不改后端、不改 config schema、不改 `constants.ts` 的数据结构。
- 不做全局"渠道×AI"映射总览表（留待后续 #5 可观测性改进）。
- 不改扫码登录流程（#2 默认值陷阱）——但本轮改动会顺带让扫码后的卡片也展示顶部 AI 区块，间接缓解该问题。

## 设计

### 呈现方式：顶部独立区块

平台卡片展开后，`aiCommand` 字段从普通字段列表里**抽离**，渲染为卡片体最顶部的独立区块；其余字段（凭证、allowedUserIds 等）按原顺序在分隔线下方渲染。

```
┌ 微信客服号（ClawBot）                    [开] ┐
│                                                  │
│  ┌ 🤖 AI 工具 ──────────────────────────────┐  │
│  │ 这个渠道收到的消息会用上面的 AI 回复      │  │
│  │                                           │  │
│  │  [ OpenCode                      ▾ ]      │  │
│  └───────────────────────────────────────────┘  │
│  ──────────────────────────────────────────────  │
│                                                  │
│  API 地址      [http://...]                      │
│  API Token     [********]                        │
│  允许用户      [...]                             │
└──────────────────────────────────────────────────┘
```

- 整个 AI 区块用弱背景色块包裹（`bg-slate-50 dark:bg-slate-800/50` + `rounded-lg p-3`），与下方凭证字段拉开视觉层级。
- 区块下方一条 `<hr />` 分隔线，再渲染剩余字段。
- 下拉框**沿用现有的 `<select>` + `AI_TOOL_DEFINITIONS`**，不额外放大或自定义样式，保持表单控件一致性——视觉层级靠区块背景表达，而非放大控件。

### 文案（i18n，固定文案，所有平台一致）

沿用现有 `PAGE_TEXTS` 扁平 key 风格（见 `src/config-web-page-i18n.ts`），新增 2 个 key：

| key | zh | en |
|-----|----|----|
| `aiCommandPickerTitle` | `🤖 AI 工具` | `🤖 AI Tool` |
| `aiCommandPickerHint` | `这个渠道收到的消息会用上面的 AI 回复` | `Messages from this channel will be replied by the AI selected above` |

### 组件结构

**关键事实**：当前代码有**两处独立的 `aiCommand` 字段渲染**，逻辑重复：

1. `web/src/components/PlatformCard.tsx:51-56` — Dashboard 用，内联 `field()` 函数里的 `f === "aiCommand"` 分支。
2. `web/src/components/SetupWizard.tsx:129-141` — 首次设置向导用，独立的 `field()` 函数里的 `f === "aiCommand"` 分支（**SetupWizard 没有复用 PlatformCard，是自己渲染字段列表的**）。

因此本设计把 `aiCommand` 的渲染**抽成共享组件**，两处都复用，同时消除现有重复代码——符合"改善正在改的代码"原则。

**新增** `web/src/components/AiCommandPicker.tsx`：

```
AiCommandPicker
├── 标题行：t("aiCommandPickerTitle")     // "🤖 AI 工具"
├── 说明文字：t("aiCommandPickerHint")    // 固定文案
└── <select> 下拉框                       // 复用 AI_TOOL_DEFINITIONS 数据源
```

Props：

```ts
interface AiCommandPickerProps {
  value: AiCommand;
  onChange: (v: AiCommand) => void;
  t: (k: string) => string;
}
```

**改动** `web/src/components/PlatformCard.tsx`：

1. `fields.map(field)` 循环里，当 `f === "aiCommand"` 时跳过（`return null`），避免重复渲染——同时删除现有第 51-56 行内联的 `f === "aiCommand"` 分支（渲染逻辑迁移到 AiCommandPicker）。
2. 在 `{def.fields.map(field)}` **之前**插入 `<AiCommandPicker />`。
3. AiCommandPicker 与字段列表之间加一条分隔线。

PlatformCard 伪代码：

```tsx
{expanded && (
  <div className="platform-card-body">
    {sk && <p className="platform-card-hint">{t(sk)}</p>}

    {/* 新增：AI 工具顶部区块 */}
    <AiCommandPicker
      value={String((values as Record<string, string>).aiCommand || "claude") as AiCommand}
      onChange={(v) => onChange({ aiCommand: v })}
      t={t}
    />
    <hr className="platform-card-divider" />

    {/* 原字段列表（已跳过 aiCommand） */}
    {def.fields.map(field)}
    ...
  </div>
)}
```

**改动** `web/src/components/SetupWizard.tsx`：

同样删除第 140-141 行内联的 `f === "aiCommand"` 分支，在 `def.fields.map` 之前插入 `<AiCommandPicker />` + 分隔线。SetupWizard 的 `field()` 函数（第 129 行）改为：当 `f === "aiCommand"` 时 `return null`。

SetupWizard 伪代码：

```tsx
{isOpen && (
  <div className="wizard-platform-body">
    <p className="form-hint">{t(PLATFORM_SUMMARY_KEY[pk] || "")}</p>

    {/* 新增：AI 工具顶部区块 */}
    <AiCommandPicker
      value={String((v as Record<string, string>).aiCommand || "claude") as AiCommand}
      onChange={(val) => upP(pk, { aiCommand: val })}
      t={t}
    />
    <hr className="platform-card-divider" />

    {/* 原字段列表（已跳过 aiCommand） */}
    {def.fields.map(f => field(def, f, pk))}
    ...
  </div>
)}
```

> **重要**：SetupWizard 扫码登录成功后（`SetupWizard.tsx:100` 附近）只 patch `apiToken/apiUrl/enabled`，不碰 `aiCommand`——顶部 AI 区块会让用户在扫码后**立即看到**当前用的是 claude，从而意识到可以改。这顺带缓解了"扫码默认值陷阱"（产品问题 #2），无需单独改动扫码流程。

## 改动文件清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `web/src/components/AiCommandPicker.tsx` | 新增 | 顶部 AI 区块组件，约 30 行 |
| `web/src/components/PlatformCard.tsx` | 修改 | 跳过 aiCommand 字段 + 插入 AiCommandPicker + 分隔线，约改 15 行 |
| `web/src/components/SetupWizard.tsx` | 修改 | 同上：跳过 aiCommand 字段 + 插入 AiCommandPicker + 分隔线，约改 15 行 |
| `src/config-web-page-i18n.ts` | 修改 | 新增 2 个 i18n key（zh/en 各 2 条） |
| `web/src/styles/global.css`（如需） | 修改 | 新增 `.platform-card-divider` 分隔线样式（若不直接用 Tailwind class） |

**不改动**：`constants.ts`、后端任何代码、config schema、扫码登录流程。

## 验证计划

手动验证（无新增自动化测试，纯展示组件）：

1. Dashboard 中依次展开 7 个平台卡片，确认 AI 工具区块都在顶部、视觉醒目，下拉框可正常切换并保存。
2. SetupWizard 中展开 7 个平台卡片，同样确认顶部 AI 区块存在且可用（验证双路径复用）。
3. 在 ClawBot 卡片把 AI 切到 opencode，保存，确认 `config.json` 中 `platforms.clawbot.aiCommand === "opencode"`。
4. 切换 zh/en 语言，确认标题和说明文案正确切换。
5. 暗色模式下视觉无破损。

## 风险

- **低**：`field()` 函数里跳过 aiCommand 后，需确保不存在其它依赖该循环渲染 aiCommand 的代码路径（两处 `field()` 函数都已覆盖）。
- **低**：SetupWizard 的 `field()` 与 PlatformCard 的 `field()` 是两套独立实现，改动需同步两处——已在组件结构章节明确双路径改动，实现时按 spec 执行即可。
