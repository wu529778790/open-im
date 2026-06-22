# AI Command Picker 顶部置顶 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把每个 IM 平台卡片的 `aiCommand` 字段从普通字段列表里抽离，渲染为卡片体最顶部的独立醒目区块，让用户一眼可见"这个渠道用什么 AI 回复"，从而传达"AI 工具按渠道独立配置"的心智模型。

**Architecture:** 新建一个共享展示组件 `AiCommandPicker`，在 Dashboard 的 `PlatformCard` 和首次设置 `SetupWizard` 两处复用；两处各自的 `field()` 渲染函数中删除内联的 `aiCommand` 分支改为 `return null`，在 `fields.map()` 之前插入 `<AiCommandPicker />` + 分隔线。后端、config schema、扫码登录流程均不改动。

**Tech Stack:** React + TypeScript（web/），自定义 CSS（`web/src/styles/global.css`）+ CSS 变量。**注意：本项目没有 Tailwind**，spec 草稿里的 `bg-slate-50 dark:bg-slate-800/50` 等 Tailwind class 不可用，本 plan 统一改用现有的自定义 CSS class + CSS 变量（`var(--c-surface-alt)` 等），与现有 `platform-card`、`wizard-platform-card` 风格一致。

---

## File Structure

| 文件 | 改动类型 | 职责 |
|------|---------|------|
| `web/src/components/AiCommandPicker.tsx` | **新增** | 纯展示组件：标题 + 说明 + `<select>` 下拉框，复用 `AI_TOOL_DEFINITIONS` |
| `web/src/components/PlatformCard.tsx` | 修改 | 删内联 `aiCommand` 分支、在字段列表前插入 `<AiCommandPicker/>` + 分隔线 |
| `web/src/components/SetupWizard.tsx` | 修改 | 同上（双路径复用） |
| `src/config-web-page-i18n.ts` | 修改 | 新增 2 个 i18n key（zh/en 各 2 条） |
| `web/src/styles/global.css` | 修改 | 新增 `.ai-command-picker` 区块 + `.platform-card-divider` 分隔线样式 |

**不改动**：`constants.ts`、`tool-definitions.ts`、后端任何代码、config schema、扫码登录流程。

---

## Task 1: 新增 i18n 文案

新增两个固定文案 key（所有平台一致），分别加到 `en` 块末尾和 `zh` 块末尾。

**Files:**
- Modify: `src/config-web-page-i18n.ts:221`（en 块最后一条 `wizardLoading` 之后）
- Modify: `src/config-web-page-i18n.ts:439`（zh 块最后一条 `wizardLoading` 之后）

- [ ] **Step 1: 在 en 块末尾新增 2 个 key**

编辑 `src/config-web-page-i18n.ts`，找到 en 块的结尾：

```
          wizardLoading: "Loading...",
        },
```

改为：

```diff
          wizardLoading: "Loading...",
          aiCommandPickerTitle: "🤖 AI Tool",
          aiCommandPickerHint: "Messages from this channel will be replied by the AI selected above",
        },
```

- [ ] **Step 2: 在 zh 块末尾新增 2 个 key**

找到 zh 块的结尾：

```
          wizardLoading: "\u52a0\u8f7d\u4e2d...",
        }
```

改为：

```diff
          wizardLoading: "\u52a0\u8f7d\u4e2d...",
          aiCommandPickerTitle: "🤖 AI 工具",
          aiCommandPickerHint: "这个渠道收到的消息会用上面的 AI 回复",
        }
```

> 注：zh 块是整个对象的最后一个属性，末尾是 `}`（无逗号）；en 块后面还有 zh 块，末尾是 `},`（有逗号）。保持原文件风格不变。

- [ ] **Step 3: 验证 i18n 文件类型检查通过**

Run: `cd /Users/mac/github/open-im && npx tsc --noEmit -p web/tsconfig.json`
Expected: 无新增报错（如果项目本身有既有警告可忽略，只要没有与 `aiCommandPicker*` 相关的错误即可）。

- [ ] **Step 4: Commit**

```bash
git add src/config-web-page-i18n.ts
git commit -m "feat(i18n): add aiCommandPickerTitle/Hint for AI tool picker"
```

---

## Task 2: 新增 CSS 样式

新增 AI 区块背景容器 + 分隔线样式。用现有 CSS 变量（`var(--c-surface-alt)` / `var(--c-border)`）实现深浅色自适应，**不引入 Tailwind**。

**Files:**
- Modify: `web/src/styles/global.css`（在 `.platform-card-body` 规则附近，约第 331 行 `.platform-card-help` 之前插入）

- [ ] **Step 1: 新增 `.ai-command-picker` 与 `.platform-card-divider` 规则**

在 `web/src/styles/global.css` 中找到：

```css
.platform-card-body {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
```

在其**之后**插入：

```css
/* ── AI 工具顶部区块（AiCommandPicker） ── */
.ai-command-picker {
  background: var(--c-surface-alt);
  border: 1px solid var(--c-border);
  border-radius: var(--r-m);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ai-command-picker-title {
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text);
}
.ai-command-picker-hint {
  font-size: 12px;
  color: var(--c-text-2);
}
.ai-command-picker .form-select {
  margin-top: 2px;
}

/* ── AI 区块与下方字段之间的分隔线（Dashboard + Wizard 共用） ── */
.platform-card-divider {
  border: 0;
  border-top: 1px solid var(--c-border);
  margin: 0;
}
```

> 说明：`var(--c-surface-alt)` 在浅色模式是 `#f5f5f5`、深色模式是 `#1e1e24`，自动适配暗色模式，无需额外 `dark:` class。`var(--r-m)`、`var(--font-display)` 均为项目既有变量。

- [ ] **Step 2: 验证 CSS 无语法错误**

Run: `cd /Users/mac/github/open-im && npm run web:build`
Expected: Vite 构建成功，无 CSS 报错。

- [ ] **Step 3: Commit**

```bash
git add web/src/styles/global.css
git commit -m "style: add ai-command-picker and platform-card-divider CSS"
```

---

## Task 3: 新增 AiCommandPicker 组件

纯展示组件，约 35 行。Props：`value`、`onChange`、`t`。复用 `AI_TOOL_DEFINITIONS` 作为下拉数据源。

**Files:**
- Create: `web/src/components/AiCommandPicker.tsx`

- [ ] **Step 1: 创建组件文件**

写入 `web/src/components/AiCommandPicker.tsx`：

```tsx
import type { AiCommand } from "../types.js";
import { AI_TOOL_DEFINITIONS } from "../tool-definitions.js";

interface AiCommandPickerProps {
  value: AiCommand;
  onChange: (v: AiCommand) => void;
  t: (k: string) => string;
}

/**
 * 平台卡片顶部的 AI 工具选择区块。
 * 把"这个渠道用什么 AI 回复"提升为视觉层级最高的字段，
 * 传达"每个渠道独立配置 AI"的心智模型。
 */
export function AiCommandPicker({ value, onChange, t }: AiCommandPickerProps) {
  return (
    <div className="ai-command-picker">
      <div className="ai-command-picker-title">{t("aiCommandPickerTitle")}</div>
      <div className="ai-command-picker-hint">{t("aiCommandPickerHint")}</div>
      <select
        className="form-select"
        value={String(value || "claude")}
        onChange={(e) => onChange(e.target.value as AiCommand)}
      >
        {AI_TOOL_DEFINITIONS.map((tool) => (
          <option key={tool.key} value={tool.key}>
            {tool.label}
          </option>
        ))}
      </select>
    </div>
  );
}
```

> `AiCommand` 类型从 `../types.js` re-export（见 `web/src/types.ts:3`），与现有 `PlatformCard.tsx:3`、`SetupWizard.tsx:4` 的导入路径一致。`t` 签名取单参数版本 `(k: string) => string`，与两处调用方传入的 `t` 兼容（调用方 `t` 支持可选第二参数，单参数调用安全）。

- [ ] **Step 2: 验证类型检查通过**

Run: `cd /Users/mac/github/open-im && npx tsc --noEmit -p web/tsconfig.json`
Expected: 无报错。

- [ ] **Step 3: Commit**

```bash
git add web/src/components/AiCommandPicker.tsx
git commit -m "feat(web): add AiCommandPicker shared component"
```

---

## Task 4: 改造 PlatformCard（Dashboard 路径）

在字段列表前插入 `<AiCommandPicker />` + 分隔线，并删除内联的 `aiCommand` 渲染分支（迁移到共享组件）。

**Files:**
- Modify: `web/src/components/PlatformCard.tsx:37-63`（`field()` 函数）
- Modify: `web/src/components/PlatformCard.tsx:78-80`（卡片体渲染）

- [ ] **Step 1: 导入 AiCommandPicker**

在 `web/src/components/PlatformCard.tsx` 顶部，现有 import 块中找到：

```tsx
import { AI_TOOL_DEFINITIONS } from "../tool-definitions.js";
```

在其**之后**新增一行：

```tsx
import { AiCommandPicker } from "./AiCommandPicker.js";
```

- [ ] **Step 2: 删除 `field()` 里的 `aiCommand` 分支**

找到 `field` 函数中的三元分支（约第 51-56 行）：

```tsx
        ) : f === "aiCommand" ? (
          <select className="form-select" value={String((values as Record<string, string>)[f] || "claude")} onChange={(e) => onChange({ aiCommand: e.target.value as AiCommand })}>
            {AI_TOOL_DEFINITIONS.map((tool) => (
              <option key={tool.key} value={tool.key}>{tool.label}</option>
            ))}
          </select>
        ) : (
```

替换为（删除 aiCommand 分支，让 aiCommand 走默认 `return null` 之外的兜底——但这里 `field` 无 `return null`，需改为显式跳过）：

```tsx
        ) : f === "aiCommand" ? null : (
```

> 这样 `aiCommand` 字段在循环中渲染为 `null`，不再出现在字段列表里。`AI_TOOL_DEFINITIONS` 此后由 `AiCommandPicker` 内部使用，本文件的 import 可保留（无害）或移除；为减少未使用导入警告，下一步处理。

- [ ] **Step 3: 移除本文件不再使用的 `AI_TOOL_DEFINITIONS` import**

Step 2 后 `AI_TOOL_DEFINITIONS` 在本文件不再被引用（AiCommandPicker 内部自己 import）。但 `AiCommand` 类型**仍需保留**——Step 4 会用到 `as AiCommand`。

删除本文件顶部这一行：

```tsx
import { AI_TOOL_DEFINITIONS } from "../tool-definitions.js";
```

保留不动：

```tsx
import type { AiCommand, WebConfigPayload } from "../types.js";
import { AiCommandPicker } from "./AiCommandPicker.js";
```

- [ ] **Step 4: 在卡片体字段列表前插入 AiCommandPicker + 分隔线**

找到卡片体渲染（约第 78-80 行）：

```tsx
      {expanded && (<div className="platform-card-body">
        {sk && <p className="platform-card-hint">{t(sk)}</p>}
        {def.fields.map(field)}
```

在 `{def.fields.map(field)}` **之前**插入 AiCommandPicker 区块 + 分隔线：

```tsx
      {expanded && (<div className="platform-card-body">
        {sk && <p className="platform-card-hint">{t(sk)}</p>}

        <AiCommandPicker
          value={String((values as Record<string, string>).aiCommand || "claude") as AiCommand}
          onChange={(v) => onChange({ aiCommand: v })}
          t={t as (k: string) => string}
        />
        <hr className="platform-card-divider" />

        {def.fields.map(field)}
```

- [ ] **Step 5: 验证类型检查通过**

Run: `cd /Users/mac/github/open-im && npx tsc --noEmit -p web/tsconfig.json`
Expected: 无报错。若提示 `AiCommand` 未使用则说明 Step 4 的 `as AiCommand` 未加；若提示 `AI_TOOL_DEFINITIONS` 未使用则说明 Step 3 未删该 import。

- [ ] **Step 6: 手动验证 Dashboard 路径**

Run: `cd /Users/mac/github/open-im && npm run web:dev`（另开终端跑 `npm run dev` 或 `node dist/cli.js dashboard` 启动后端）

打开 `http://127.0.0.1:39282`，依次展开各平台卡片，确认：
1. AI 工具区块在每个卡片**顶部**、有背景色块包裹、视觉醒目；
2. 区块下方有分隔线，分隔线下才是凭证字段；
3. 下拉框可切换，切换后能保存（保存后查 `~/.open-im/config.json` 确认 `aiCommand` 更新）。

Expected: 全部符合。

- [ ] **Step 7: Commit**

```bash
git add web/src/components/PlatformCard.tsx
git commit -m "feat(web): hoist aiCommand to top block in PlatformCard"
```

---

## Task 5: 改造 SetupWizard（首次设置路径）

与 Task 4 对称：删除 `field()` 里的 `aiCommand` 分支，在字段列表前插入 `<AiCommandPicker />` + 分隔线。两处共享同一组件，消除重复代码。

**Files:**
- Modify: `web/src/components/SetupWizard.tsx:129-148`（`field()` 函数）
- Modify: `web/src/components/SetupWizard.tsx:243-246`（卡片体渲染）

- [ ] **Step 1: 导入 AiCommandPicker**

在 `web/src/components/SetupWizard.tsx` 顶部 import 块，找到：

```tsx
import { AI_TOOL_DEFINITIONS } from "../tool-definitions.js";
```

在其**之后**新增：

```tsx
import { AiCommandPicker } from "./AiCommandPicker.js";
```

- [ ] **Step 2: 删除 `field()` 里的 `aiCommand` 分支**

找到 `field` 函数中的分支（约第 140-141 行）：

```tsx
        ) : f === "aiCommand" ? (
          <select className="form-select" value={String((v as Record<string, string>)[f] || "claude")} onChange={(e) => upP(pk, { aiCommand: e.target.value as AiCommand } as Partial<typeof v>)}>{AI_TOOL_DEFINITIONS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
        ) : (
```

替换为：

```tsx
        ) : f === "aiCommand" ? null : (
```

- [ ] **Step 3: 移除不再使用的 `AI_TOOL_DEFINITIONS` import**

删除本文件顶部这一行：

```tsx
import { AI_TOOL_DEFINITIONS } from "../tool-definitions.js";
```

> `AiCommand` 类型在 Step 4 仍被 `as AiCommand` 使用，**保留** `import type { AiCommand, ... }`。

- [ ] **Step 4: 在卡片体字段列表前插入 AiCommandPicker + 分隔线**

找到 wizard 平台卡片体渲染（约第 243-246 行）：

```tsx
                  {isOpen && (
                    <div className="wizard-platform-body">
                      <p className="form-hint">{t(PLATFORM_SUMMARY_KEY[pk as keyof typeof PLATFORM_SUMMARY_KEY] || "")}</p>
                      {def.fields.map(f => field(def, f, pk))}
```

在 `{def.fields.map(f => field(def, f, pk))}` **之前**插入：

```tsx
                  {isOpen && (
                    <div className="wizard-platform-body">
                      <p className="form-hint">{t(PLATFORM_SUMMARY_KEY[pk as keyof typeof PLATFORM_SUMMARY_KEY] || "")}</p>

                      <AiCommandPicker
                        value={String((payload.platforms[pk] as Record<string, string>).aiCommand || "claude") as AiCommand}
                        onChange={(val) => upP(pk, { aiCommand: val } as Partial<WebConfigPayload["platforms"][typeof pk]>)}
                        t={t as (k: string) => string}
                      />
                      <hr className="platform-card-divider" />

                      {def.fields.map(f => field(def, f, pk))}
```

> 注意：卡片体渲染层没有 `v` 变量（`v` 只存在于 `field()` 函数内部），因此这里直接用 `payload.platforms[pk]`。

- [ ] **Step 5: 验证类型检查通过**

Run: `cd /Users/mac/github/open-im && npx tsc --noEmit -p web/tsconfig.json`
Expected: 无报错。

- [ ] **Step 6: 手动验证 Wizard 路径**

触发首次设置向导（清空 `~/.open-im/config.json` 的 platform 凭证，或用未配置状态启动）。展开各平台卡片，确认：
1. 顶部 AI 区块存在且可用（与 Dashboard 一致）；
2. 扫码登录 ClawBot 成功后，卡片顶部立即显示当前 AI（claude），用户可意识到能改——间接缓解"扫码默认值陷阱"。

Expected: 全部符合。

- [ ] **Step 7: Commit**

```bash
git add web/src/components/SetupWizard.tsx
git commit -m "feat(web): hoist aiCommand to top block in SetupWizard"
```

---

## Task 6: 全量构建 + 语言/暗色模式回归

最终验收：完整构建、切换语言、暗色模式视觉检查。

**Files:** 无新增改动，仅验证。

- [ ] **Step 1: 完整构建（含 Vite + tsc）**

Run: `cd /Users/mac/github/open-im && npm run build`
Expected: `web:build` 与 `tsc` 均成功，无报错。

- [ ] **Step 2: 运行 lint**

Run: `cd /Users/mac/github/open-im && npm run lint`
Expected: 0 errors（warnings 与基线一致，不应因本次改动新增 warning；若 `AI_TOOL_DEFINITIONS` import 残留会报 unused，回 Task 4/5 Step 3 处理）。

- [ ] **Step 3: 切换 zh/en 语言回归**

在 Dashboard 顶部切换语言，确认 7 个平台卡片顶部的 AI 区块标题与说明文案正确切换：
- zh：`🤖 AI 工具` / `这个渠道收到的消息会用上面的 AI 回复`
- en：`🤖 AI Tool` / `Messages from this channel will be replied by the AI selected above`

Expected: 文案随语言切换。

- [ ] **Step 4: 暗色模式视觉检查**

切换暗色模式，确认：
1. AI 区块背景色块在暗色下可辨（`var(--c-surface-alt)` = `#1e1e24`，与卡片主体 `#141418` 有对比）；
2. 分隔线在暗色下可见（`var(--c-border)` = `#2a2a32`）；
3. 下拉框文字可读。

Expected: 无视觉破损。

- [ ] **Step 5: 最终提交（如有 lint 修正）**

```bash
git add -A
git commit -m "chore: ai-command-picker final polish" || echo "nothing to commit"
```

---

## 验证计划对照（来自 spec）

| spec 验证项 | 对应 Task |
|------------|----------|
| Dashboard 7 卡片顶部 AI 区块醒目、可切换保存 | Task 4 Step 6 |
| SetupWizard 7 卡片顶部 AI 区块（双路径复用） | Task 5 Step 6 |
| ClawBot 切 opencode 保存后 config.json 正确 | Task 4 Step 6 |
| zh/en 文案切换 | Task 6 Step 3 |
| 暗色模式无破损 | Task 6 Step 4 |

## 风险与缓解

- **低**：两处 `field()` 是独立实现，改动需同步——Task 4 与 Task 5 对称设计，各自独立 commit，便于回滚。
- **低**：spec 草稿误用 Tailwind class——本 plan 已统一改为自定义 CSS + CSS 变量，与项目既有风格一致，无需引入新依赖。
- **低**：`AiCommand` 类型 import 是否保留取决于删改后是否仍被引用——每个 Task 末尾均有 `tsc --noEmit` 校验，以编译结果为准。
