# Native Interaction Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Claude SDK the first native-interaction bridge in open-im, keep Codex/CodeBuddy/OpenCode in open mode, and ensure Telegram choice buttons behave like ordinary user replies in the same AI conversation.

**Architecture:** Add a small product-facing capability flag to adapters (`native` vs `open`) instead of building a new approval broker. Use that capability in `runAITask` to stop forcing `skipPermissions=true` for Claude while preserving current permissive behavior for the other tools. Fix Telegram choice callbacks so button taps re-enter the normal queue and AI-request pipeline instead of using a dummy handler path.

**Tech Stack:** TypeScript, Node.js, Vitest, Telegraf, existing adapter/session/request-queue architecture

## Global Constraints

- preserve the AI tool's native interaction semantics over IM instead of inventing a unified open-im approval or choice protocol
- in the first phase, implement native interaction bridging for Claude SDK only
- keep Codex, CodeBuddy, and OpenCode in their current open execution mode
- open-im does not introduce its own approval state machine or repo/global allow system in this phase
- user replies such as `1`, `2`, `yes`, or free-form clarifications are treated as ordinary follow-up input to the same AI conversation when the tool supports it
- no unified approval broker
- no synthetic `y / n / stop / always / global` permission system
- no terminal UI mirroring or PTY cloning
- `/new`, `/resume`, and other explicit open-im commands still take precedence over normal follow-up replies

---

### Task 1: Declare Adapter Interaction Modes

**Files:**
- Modify: `src/adapters/tool-adapter.interface.ts`
- Modify: `src/adapters/claude-sdk-adapter.ts`
- Modify: `src/adapters/codex-adapter.ts`
- Modify: `src/adapters/codebuddy-adapter.ts`
- Modify: `src/adapters/opencode-adapter.ts`
- Test: `src/platform/handle-ai-request.test.ts`

**Interfaces:**
- Consumes: existing `ToolAdapter` implementations
- Produces: `type InteractionMode = 'native' | 'open'` and `readonly interactionMode` on every adapter

- [ ] **Step 1: Add the interaction-mode type and field to the shared adapter interface**

```ts
export type InteractionMode = 'native' | 'open';

export interface ToolAdapter {
  readonly toolId: string;
  readonly interactionMode: InteractionMode;
  run(
    prompt: string,
    sessionId: string | undefined,
    workDir: string,
    callbacks: RunCallbacks,
    options?: RunOptions
  ): RunHandle;
}
```

- [ ] **Step 2: Mark Claude as the only native adapter**

```ts
export class ClaudeSDKAdapter implements ToolAdapter {
  readonly toolId = 'claude-sdk';
  readonly interactionMode = 'native';
  // existing run(...) stays unchanged
}
```

- [ ] **Step 3: Mark the other adapters as open**

```ts
export class CodexAdapter implements ToolAdapter {
  readonly toolId = "codex";
  readonly interactionMode = "open";
}
```

```ts
export class CodeBuddyAdapter implements ToolAdapter {
  readonly toolId = 'codebuddy';
  readonly interactionMode = 'open';
}
```

```ts
export class OpenCodeAdapter implements ToolAdapter {
  readonly toolId = 'opencode';
  readonly interactionMode = 'open';
}
```

- [ ] **Step 4: Update adapter test doubles to satisfy the widened interface**

```ts
const adapter = {
  toolId: 'claude',
  interactionMode: 'native',
  run: vi.fn(),
};
```

Expected result: `src/platform/handle-ai-request.test.ts` and other tests that create adapter stubs compile without `interactionMode` type errors.

- [ ] **Step 5: Run the focused test file that covers AI request wiring**

Run: `npm run test -- src/platform/handle-ai-request.test.ts`
Expected: Vitest passes with the new adapter capability field


### Task 2: Use Interaction Mode To Select Permission Behavior

**Files:**
- Modify: `src/shared/ai-task.ts`
- Test: `src/shared/ai-task.test.ts`

**Interfaces:**
- Consumes: `toolAdapter.interactionMode`, `config.skipPermissions`, existing `RunOptions`
- Produces: per-tool permission behavior where Claude native flow does not force open mode, while Codex/CodeBuddy/OpenCode keep current permissive execution

- [ ] **Step 1: Extract permission-option building into a small helper inside `ai-task.ts`**

```ts
function buildRunOptions(
  config: Config,
  sessionManager: SessionManager,
  ctx: TaskContext,
  aiCommand: string,
  toolAdapter: ToolAdapter,
): RunOptions {
  const defaultSkipPermissions =
    toolAdapter.interactionMode === 'native'
      ? false
      : (config.skipPermissions ?? true);

  return {
    model: aiCommand === 'claude'
      ? (sessionManager.getModel(ctx.userId, ctx.threadId) ?? config.claudeModel)
      : aiCommand === 'opencode'
        ? config.opencodeModel
        : undefined,
    chatId: ctx.chatId,
    skipPermissions: defaultSkipPermissions,
    skipAutoResume: sessionManager.isFreshSession(ctx.userId),
    ...(aiCommand === 'codex' && config.codexProxy ? { proxy: config.codexProxy } : {}),
  };
}
```

- [ ] **Step 2: Replace the inline `run(...)` options object with the helper**

```ts
activeHandle = toolAdapter.run(
  prompt,
  currentSessionId,
  ctx.workDir,
  callbacks,
  buildRunOptions(config, sessionManager, ctx, aiCommand, toolAdapter),
);
```

Expected result: the permission decision becomes explicit and tied to the adapter capability instead of a single global default.

- [ ] **Step 3: Add a test that Claude native mode does not force `skipPermissions: true`**

```ts
it("does not force skipPermissions for native Claude adapters", async () => {
  const sessionManager = {
    addTurnsForThread: vi.fn(() => 0),
    addTurns: vi.fn(() => 0),
    setSessionIdForThread: vi.fn(),
    setSessionIdForConv: vi.fn(),
    clearSessionForConv: vi.fn(),
    clearActiveToolSession: vi.fn(),
    getModel: vi.fn(() => undefined),
    isFreshSession: vi.fn(() => false),
  };
  const streamUpdate = vi.fn();
  const sendComplete = vi.fn(async () => {});
  const sendError = vi.fn(async () => {});
  const runOptions: unknown[] = [];
  const toolAdapter: ToolAdapter = {
    toolId: "claude",
    interactionMode: "native",
    run(_prompt, _sessionId, _workDir, callbacks, options) {
      runOptions.push(options);
      callbacks.onComplete({
        success: true,
        result: "done",
        accumulated: "done",
        cost: 0,
        durationMs: 1,
        numTurns: 1,
        toolStats: {},
      });
      return { abort: vi.fn() };
    },
  };

  await runAITask(
    {
      config: {
        platforms: {
          telegram: { enabled: true, aiCommand: "claude", allowedUserIds: [] },
        },
        enabledPlatforms: ["telegram"],
        claudeModel: "claude-opus-4-5",
        codexProxy: "",
        dingtalkClientId: "",
        dingtalkClientSecret: "",
        qqAppId: "",
        qqSecret: "",
        weworkCorpId: "",
        weworkSecret: "",
        telegramBotToken: "",
      } as never,
      sessionManager: sessionManager as never,
    },
    {
      userId: "u1",
      chatId: "c1",
      workDir: "/tmp/project",
      sessionId: undefined,
      convId: "conv-native",
      platform: "telegram",
      taskKey: "task-native",
    },
    "hello",
    toolAdapter,
    {
      streamUpdate,
      sendComplete,
      sendError,
      throttleMs: 0,
      onTaskReady: vi.fn(),
    }
  );
  expect(runOptions[0]).toMatchObject({ skipPermissions: false });
});
```

- [ ] **Step 4: Update existing non-Claude tests to declare `interactionMode: 'open'` and preserve current expectations**

```ts
const toolAdapter: ToolAdapter = {
  toolId: "codex",
  interactionMode: "open",
  run(_prompt, _sessionId, _workDir, callbacks, options) {
    runOptions.push(options);
    callbacks.onComplete({
      success: true,
      result: "done",
      accumulated: "ok",
      cost: 0,
      durationMs: 1,
      numTurns: 1,
      toolStats: {},
    });
    return { abort: vi.fn() };
  },
};
```

Expected result: current Codex/CodeBuddy/OpenCode behavior remains permissive and existing assertions around `model`/error handling still pass.

- [ ] **Step 5: Run the focused AI-task test file**

Run: `npm run test -- src/shared/ai-task.test.ts`
Expected: Vitest passes, including the new Claude-native permission regression test


### Task 3: Route Telegram Choice Buttons Through The Normal Text Flow

**Files:**
- Modify: `src/telegram/event-handler.ts`
- Test: `src/platform/handle-text-flow.test.ts`
- Test: `src/telegram/message-sender.ts` (only if an existing or new sender-focused test file already exists; otherwise keep this task in the event-handler and text-flow tests)

**Interfaces:**
- Consumes: `handleTextFlow`, shared platform event context, existing `handleAIRequest`, `sessionManager`, `sendTextReply`
- Produces: choice-button taps that behave like a user typing `1`, `2`, etc. into the same Telegram conversation

- [ ] **Step 1: Remove the lazy-import dummy flow from the `choice:` callback branch**

Replace this pattern:

```ts
const { handleTextFlow } = await import("../platform/handle-text-flow.js");

await handleTextFlow({
  platform: "telegram",
  userId,
  chatId,
  text: choiceNum,
  ctx: createPlatformEventContext({ ... }),
  handleAIRequest: async () => {},
  sendTextReply: async (c, t) => {
    await sendTextReply(c, t);
  },
  workDir: sessionManager.getWorkDir(userId),
  convId: sessionManager.getConvId(userId),
});
```

with the real shared context and real handler:

```ts
await handleTextFlow({
  platform: 'telegram',
  userId,
  chatId,
  text: choiceNum,
  ctx,
  handleAIRequest,
  sendTextReply,
  workDir: sessionManager.getWorkDir(userId),
  convId: sessionManager.getConvId(userId),
});
```

- [ ] **Step 2: Preserve callback-query acknowledgement after the bridged reply is queued**

```ts
await ctx.answerCbQuery(`已选择 ${choiceNum}`);
```

Expected result: the UI acknowledgement remains unchanged, but the AI reply path now uses the same queue, session, and adapter flow as an ordinary Telegram text message.

- [ ] **Step 3: Add a regression test for numeric follow-up handling through the shared text flow**

```ts
it('treats Telegram numeric follow-up input as a normal queued AI message', async () => {
  const enqueue = vi.fn(() => 'running');
  const handleAIRequest = vi.fn(async () => {});

  await handleTextFlow({
    platform: 'telegram',
    userId: 'u1',
    chatId: 'c1',
    text: '2',
    ctx: {
      accessControl: { isAllowed: () => true },
      commandHandler: { dispatch: vi.fn(async () => false) },
      requestQueue: { enqueue, clear: vi.fn() },
    } as never,
    handleAIRequest,
    sendTextReply: vi.fn(async () => {}),
    workDir: '/tmp/project',
    convId: 'conv-1',
  });

  expect(enqueue).toHaveBeenCalledWith(
    'u1',
    'conv-1',
    '2',
    expect.any(Function),
  );
});
```

- [ ] **Step 4: Verify the Telegram event-handler still compiles against the shared context references**

Run: `npm run build:ts`
Expected: TypeScript exits successfully with no `handleAIRequest`/`ctx`/closure reference errors in `src/telegram/event-handler.ts`


### Task 4: Add Focused Product-Level Regression Coverage

**Files:**
- Modify: `src/shared/ai-task.test.ts`
- Modify: `src/platform/handle-ai-request.test.ts`
- Modify: `src/platform/handle-text-flow.test.ts`

**Interfaces:**
- Consumes: completed capability and Telegram bridge wiring from Tasks 1-3
- Produces: regression coverage for the phase-1 contract: Claude is native, others stay open, and follow-up choices re-enter the normal request path

- [ ] **Step 1: Add a handle-AI-request test that passes through adapter capability without changing platform startup flow**

```ts
it('still sends the thinking message and invokes runAITask for native adapters', async () => {
  const adapter = {
    toolId: 'claude',
    interactionMode: 'native',
    run: vi.fn(),
  };
  vi.mocked(getAdapter).mockReturnValue(adapter as never);
  vi.mocked(runAITask).mockResolvedValue(undefined);

  await handler({
    userId: 'user-1',
    chatId: 'chat-1',
    prompt: 'hello',
    workDir: '/tmp',
    convId: 'conv-1',
  });

  expect(sender.sendThinkingMessage).toHaveBeenCalledWith('chat-1', undefined, 'claude');
  expect(runAITask).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Add a shared-AI-task regression test that open-mode tools still default to permissive execution**

```ts
it("keeps skipPermissions enabled for open-mode tools", async () => {
  const sessionManager = {
    addTurnsForThread: vi.fn(() => 0),
    addTurns: vi.fn(() => 0),
    setSessionIdForThread: vi.fn(),
    setSessionIdForConv: vi.fn(),
    clearSessionForConv: vi.fn(),
    clearActiveToolSession: vi.fn(),
    getModel: vi.fn(() => undefined),
    isFreshSession: vi.fn(() => false),
  };
  const streamUpdate = vi.fn();
  const sendComplete = vi.fn(async () => {});
  const sendError = vi.fn(async () => {});
  const runOptions: unknown[] = [];
  const toolAdapter: ToolAdapter = {
    toolId: "codex",
    interactionMode: "open",
    run(_prompt, _sessionId, _workDir, callbacks, options) {
      runOptions.push(options);
      callbacks.onComplete({
        success: true,
        result: "done",
        accumulated: "ok",
        cost: 0,
        durationMs: 1,
        numTurns: 1,
        toolStats: {},
      });
      return { abort: vi.fn() };
    },
  };

  await runAITask(
    {
      config: {
        platforms: {
          qq: { enabled: true, aiCommand: "codex", allowedUserIds: [] },
        },
        enabledPlatforms: ["qq"],
        claudeModel: "claude-opus-4-5",
        codexProxy: "",
        dingtalkClientId: "",
        dingtalkClientSecret: "",
        qqAppId: "",
        qqSecret: "",
        weworkCorpId: "",
        weworkSecret: "",
        telegramBotToken: "",
      } as never,
      sessionManager: sessionManager as never,
    },
    {
      userId: "u1",
      chatId: "c1",
      workDir: "/tmp/project",
      sessionId: undefined,
      convId: "conv-open",
      platform: "qq",
      taskKey: "task-open",
    },
    "hello",
    toolAdapter,
    {
      streamUpdate,
      sendComplete,
      sendError,
      throttleMs: 0,
      onTaskReady: vi.fn(),
    }
  );
  expect(runOptions[0]).toMatchObject({ skipPermissions: true });
});
```

- [ ] **Step 3: Re-run the focused Vitest files as a small regression suite**

Run: `npm run test -- src/platform/handle-ai-request.test.ts src/platform/handle-text-flow.test.ts src/shared/ai-task.test.ts`
Expected: all three focused suites pass

- [ ] **Step 4: Run the TypeScript build after the focused tests**

Run: `npm run build:ts`
Expected: `tsc` exits successfully


### Task 5: Final Verification And Commit

**Files:**
- Modify: `src/adapters/tool-adapter.interface.ts`
- Modify: `src/adapters/claude-sdk-adapter.ts`
- Modify: `src/adapters/codex-adapter.ts`
- Modify: `src/adapters/codebuddy-adapter.ts`
- Modify: `src/adapters/opencode-adapter.ts`
- Modify: `src/shared/ai-task.ts`
- Modify: `src/shared/ai-task.test.ts`
- Modify: `src/platform/handle-ai-request.test.ts`
- Modify: `src/platform/handle-text-flow.test.ts`
- Modify: `src/telegram/event-handler.ts`

**Interfaces:**
- Consumes: completed work from Tasks 1-4
- Produces: a shippable phase-1 native interaction bridge baseline

- [ ] **Step 1: Review the final diff for scope control**

Run: `git diff -- src/adapters/tool-adapter.interface.ts src/adapters/claude-sdk-adapter.ts src/adapters/codex-adapter.ts src/adapters/codebuddy-adapter.ts src/adapters/opencode-adapter.ts src/shared/ai-task.ts src/shared/ai-task.test.ts src/platform/handle-ai-request.test.ts src/platform/handle-text-flow.test.ts src/telegram/event-handler.ts`
Expected: only interaction-mode declarations, permission-option routing, Telegram choice re-entry, and related tests appear

- [ ] **Step 2: Run the full unit test suite for confidence**

Run: `npm run test`
Expected: Vitest completes successfully

- [ ] **Step 3: Run the full TypeScript build**

Run: `npm run build:ts`
Expected: TypeScript compilation succeeds

- [ ] **Step 4: Commit the implementation**

```bash
git add src/adapters/tool-adapter.interface.ts src/adapters/claude-sdk-adapter.ts src/adapters/codex-adapter.ts src/adapters/codebuddy-adapter.ts src/adapters/opencode-adapter.ts src/shared/ai-task.ts src/shared/ai-task.test.ts src/platform/handle-ai-request.test.ts src/platform/handle-text-flow.test.ts src/telegram/event-handler.ts
git commit -m "feat: add native interaction bridge baseline"
git push origin main
```
