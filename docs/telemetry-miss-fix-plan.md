# Plan: close the `miss` telemetry gap (unclosed `ai.task.start`)

> **Status: Option A implemented.** The `emitInterruptedTerminals` helper +
> `TaskRunState` context fields + wiring into `shutdown()` and the
> `uncaughtException` handler are done and covered by tests. Option B (defensive
> next-start correlation) is **not** implemented — reserved for if residual
> `miss` remains after this ships and re-measures (SIGKILL/OOM only).

## Background / evidence

The health report flags `miss = 29` over the lifetime of the data: tasks that
emitted `ai.task.start` but never a terminal `ai.task.complete` / `ai.task.error`.
The miss set is **ongoing, not historical** (05-16: 5, 05-17: 2, 05-22: 1, 05-24: 2)
and is dominated by the Claude SDK adapter (22/29).

Investigation (see `src/shared/ai-task.ts`, `src/adapters/claude-sdk-adapter.ts`,
`src/index.ts`):

- Every **in-process** code path in the Claude adapter reaches a terminal:
  `onComplete` → complete; no-result-stream-end / catch / `.catch(runSession)` →
  error; `handle.abort()` → aborted. A normal run therefore cannot strand a task.
- The **clean** `shutdown()` (`src/index.ts:319`) iterates `handle.runningTasks`
  and calls `state.handle.abort()` — which emits `aborted`. So a single clean
  SIGTERM does **not** strand tasks.

**Root cause = exit paths that terminate the process before a terminal event is
written for an in-flight task.** Concretely:

1. **`uncaughtException` handler** (`src/index.ts:371`) calls
   `shutdownLoggerTelemetry().then(() => process.exit(1))` but **never aborts
   in-flight tasks**. Any task mid-flight at crash time leaves a `start` with no
   terminal. This is the most likely contributor — it is reachable from any
   uncaught throw, including the `[Queue] Unhandled error` and adapter rejections.
2. **A second SIGINT/SIGTERM during shutdown.** `shutdown()` is `async` and
   `await`s `sendLifecycleNotification` + `PLATFORM_MODULES.stop()`; while it is
   mid-await, a second signal is not handled (the `shuttingDown` guard prevents
   re-entry) and the default action terminates the process, again mid-task.
3. **Un-catchable termination** — SIGKILL, OOM, power loss. No code change can
   emit a terminal for these; the only mitigation is to make the *exit* itself
   the terminal signal (option B below) rather than trying to emit before exit.

(Side note: the `[Queue] Unhandled error in task execution` path
(`src/queue/request-queue.ts:45`) is itself suspect — an error thrown out of
`runAITask` there would reject the queue's promise and may propagate as an
unhandled rejection → path #1. Worth confirming during implementation.)

## Scope / non-goals

- **In scope:** guarantee every `ai.task.start` has a matching terminal event for
  *catchable* exits (graceful shutdown, double-signal, `uncaughtException`).
- **Out of scope (cannot fix):** SIGKILL / OOM / power loss. The design below
  makes those diagnosable rather than invisible.
- **Out of scope (per user):** upload-transport failures (`net` / `rtry` /
  `drop4`) — customer network.

## Design options

### Option A — emit a terminal marker before every catchable exit (recommended)

Add a single helper that, for every platform's `runningTasks`, emits one
`ai.task.error` with `errorType: 'interrupted'` for any task still present (i.e.
started but not yet terminated). Call it as the **first** action of `shutdown()`
and as the **first** action of the `uncaughtException` handler, *before*
flushing telemetry. Tasks that already settled are absent from `runningTasks`
(settled ⇒ deleted in `handle-ai-request.ts:200`), so only genuinely-in-flight
tasks get the marker.

Why it works:
- `shutdown()` currently aborts tasks *after* notifications; moving terminal
  emission to the very front means even if a second signal kills the process
  during the subsequent `await`s, the terminal was already written to the
  events JSONL stream (`eventsStream.write` is synchronous-ish; see risk below).
- `uncaughtException` currently skips tasks entirely; emitting the marker there
  closes the largest contributor.

Implementation sketch (≈30 lines, no new files):

1. Extend `TaskRunState` (`src/shared/ai-task.ts`) with the context the marker
   needs, which it currently lacks:
   ```ts
   export interface TaskRunState {
     handle: { abort: () => void };
     latestContent: string;
     settle: () => void;
     startedAt: number;
     toolId: string;
     // NEW: minimal context to emit a terminal marker without re-deriving it
     taskKey: string;
     platform: string;
     userKey: string; // already-hashed userId
   }
   ```
   Populate from `ctx` in `runAITask` where `taskState` is built
   (`src/shared/ai-task.ts` ~line 358).

2. Add a shared helper, e.g. `src/shared/task-cleanup.ts` (already exists, knows
   about `runningTasks`):
   ```ts
   export function emitInterruptedTerminals(
     platform: string,
     runningTasks: Map<string, TaskRunState>,
   ): void {
     const now = Date.now();
     for (const [, state] of runningTasks) {
       emitStructuredEvent('AITask', 'ai.task.error', {
         platform: state.platform,
         taskKey: state.taskKey,
         userKey: state.userKey,
         toolId: state.toolId,
         durationMs: now - state.startedAt,
         errorSnippet: 'interrupted',
         errorType: 'interrupted', // NEW type — distinguish from user 'aborted'
       });
     }
   }
   ```
   And add `'interrupted'` handling to `classifyErrorType` (or special-case it in
   the abort path; the field is set explicitly so the classifier is not consulted
   for the abort path — confirmed in `ai-task.ts`).

3. Wire it into `src/index.ts`:
   - At the **top** of `shutdown()`, before notifications: loop
     `successfulPlatforms` → `activeHandles.get(platform)?.runningTasks` →
     `emitInterruptedTerminals(...)`. Keep the existing `abort()` loop where it
     is (it still fires `aborted` for tasks that settle through `handle.abort`;
     that's fine and idempotent — `settled` guards re-emission).
   - At the **top** of the `uncaughtException` handler, same loop, *before*
     `shutdownLoggerTelemetry()`.

Risk: emit ordering vs. flush. `emitStructuredEvent` writes to the JSONL
`eventsStream` **and** enqueues to the upload queue. On a hard exit the JSONL
write is the durable record (the local file under `~/.open-im/logs/`); the
upload is best-effort. Since the report reads from R2 (uploaded), a terminal
emitted during `uncaughtException` must be uploaded to show up in the report —
`shutdownTelemetryUpload()` runs after emission, so it will be included in the
final batch. **Verify the flush actually includes lines emitted immediately
before shutdown** during implementation (there may be a race with the
`flushing` guard in `telemetry-upload.ts`).

### Option B — treat a missing-terminal-on-next-start as the terminal (defensive, complements A)

Track the last-known-active `taskKey` per (platform, userKey). On the *next*
`ai.task.start` for the same key, if the previous run had no terminal, emit a
synthetic `ai.task.error { errorType: 'interrupted' }` retroactively. This catches
the un-catchable exits (SIGKILL/OOM) that Option A cannot, at the cost of a
heuristic (next-start correlation) that can misattribute if a user legitimately
starts a new task after a completed one whose terminal was merely delayed in
upload. **Recommend implementing only if Option A leaves a significant residual**
— re-measure `miss` after A ships first.

## Test plan (TDD)

New tests in `src/shared/task-cleanup.test.ts` (already exists) and
`src/index.ts`-adjacent tests:

1. `emitInterruptedTerminals` emits exactly one `ai.task.error { interrupted }`
   per entry in `runningTasks`, and zero for an empty map.
2. It reads `platform/taskKey/userKey/toolId/durationMs` correctly from
   `TaskRunState`.
3. (Lifecycle) Given a fake platform handle with one running task, the
   `shutdown()` entry path emits the interrupted terminal **before** calling
   `handle.abort()` / platform `.stop()`. (Use a test double; `shutdown` may need
   to be factored out of the `main` closure to be unit-testable — note as a
   refactor prerequisite.)

## Out of caution — what NOT to do

- Do **not** add a generic `process.on('exit', ...)` flush that touches async
  work — the `exit` event runs synchronously and async uploads won't complete.
- Do **not** change the existing `handle.abort()` emission of `aborted`; keep the
  new `interrupted` type distinct so the report can tell user-initiated abort
  from process-interruption.
- Do **not** bundle the `request-queue.ts` error-propagation fix into this; file
  it separately after confirming it contributes to `uncaughtException`.

## Acceptance

After deploying Option A and waiting one full data cycle, re-run:
`node scripts/telemetry-health-report.mjs logs/r2-events/events`. The
`miss` ALERT should drop to near zero (residual only from SIGKILL/OOM). If a
residual remains, evaluate Option B.
