## Autopilot: Built-in Rate-Limit Auto-Recovery for open-im

### Problem

When open-im routes IM messages to AI coding tools (Claude Code, Codex, CodeBuddy, OpenCode), the AI tools may hit rate limits (429 API rate limit, 529 server overload, session quota exhaustion, temporary throttling). Currently, all rate-limit errors are passed through to the user as generic error messages via IM. The user must manually wait and resend their message.

This is especially painful for open-im's core use case: sending long tasks from a phone and expecting them to run unattended.

### Solution

Add a shared rate-limit interceptor at the `ai-task.ts` orchestration layer. When any AI adapter reports a rate-limit error via `onError`, the interceptor catches it, extracts the reset time, notifies the user via IM, starts a timer, and when the timer fires, sends a "continue" message through the existing request queue — exactly as if the user had manually typed "继续".

### Why This Approach

**Shared interceptor, not per-adapter.** The retry logic lives in `ai-task.ts`, the common orchestration layer that all adapters pass through. This means:

- All four AI adapters (Claude, Codex, CodeBuddy, OpenCode) get rate-limit recovery automatically, with zero adapter changes.
- The interceptor is a single code path to maintain, not four copies.
- Adding future adapters requires no rate-limit awareness on their part.

**Reuse existing infrastructure.** The recovery action is just sending "继续" as a new message through `requestQueue.enqueue()`. This reuses the existing request queue, session management, and IM notification pipeline. No new execution paths, no callback wrapping, no adapter-level retry loops.

**No abort needed.** When a rate limit hits, the AI task naturally stops (the error propagates through `onError`). The session is preserved on disk. We just need to schedule a future "continue" message. No need to abort handles, wrap callbacks, or manage complex state transitions.

### Architecture

```
User sends message via IM
    |
    v
handle-text-flow.ts -> requestQueue.enqueue() -> handle-ai-request.ts -> ai-task.ts
                                                                              |
                                                                              v
                                                                   adapter.run(prompt, ...)
                                                                              |
                                                              +---------------+---------------+
                                                              |                               |
                                                         Success                         Error (onError)
                                                              |                               |
                                                              v                               v
                                                         onComplete               +-----------+-----------+
                                                                                  |                       |
                                                                             Rate limit?            Other error
                                                                                  |                       |
                                                                                  v                       v
                                                                    1. Parse reset time        Normal error flow
                                                                    2. Notify user via IM      (sendError to IM)
                                                                    3. Start timer
                                                                    4. Timer fires ->
                                                                       enqueue("继续")
                                                                       via requestQueue
```

### Detailed Behavior

**Rate-limit detection** happens in the `onError` handler within `runAITask()` (`src/shared/ai-task.ts`). The error string is tested against known patterns:

| Pattern | Type | Wait Strategy |
|---|---|---|
| `session limit` / `usage limit` / `Opus limit` + time | Session quota | Parsed reset time, or default 5h |
| `session limit` / `usage limit` (no time) | Session quota | Default interval (configurable) |
| `429 rate_limit` / `rate limit exceeded` | API rate limit | Retry-After header, or default interval |
| `529 overloaded` | Server overload | Short delay (60s default) |
| `temporarily limiting requests` | Temporary throttle | Short delay (60s default) |

**Reset time extraction** uses regex matching on the error string (reusing patterns from claude-code-autopilot). If no time can be extracted, the config's `defaultIntervalHours` (default: 5) is used. For 529/temporary errors, `shortRetrySeconds` (default: 60) is used.

**User notification** reuses the existing `TaskAdapter.streamUpdate(content, toolNote)` mechanism. The rate-limit status appears in the same position as tool-call notes on the IM message card. Example:

```
⏳ 检测到会话额度限制，将在 15:00（2小时23分钟后）自动恢复
```

**Timer** uses `setTimeout` with `unref()` so it doesn't prevent the process from exiting. For delays exceeding `setTimeout`'s ~24.8-day maximum (extremely unlikely but handled), the timer is segmented.

**Recovery action** enqueues a new message ("继续", configurable via `autoResumePrompt`) through `requestQueue.enqueue()` for the same user and conversation. The session manager preserves the session ID, so the AI tool resumes the same conversation context.

**Retry counting** tracks the number of consecutive auto-resumes for a single task chain. If `maxRetries` (default: 5) is reached, the interceptor stops retrying and sends the error to the user normally.

**Abort handling** is automatic: if the user sends `/new` or cancels the task while a timer is pending, the request queue's `cancelUser()` aborts the running task. The timer's `AbortSignal` listener fires and clears the pending retry.

### Configuration

Added under `tools.claude.autopilot` in `~/.open-im/config.json` (all optional):

```json
{
  "tools": {
    "claude": {
      "autopilot": {
        "enabled": true,
        "maxRetries": 5,
        "defaultIntervalHours": 5,
        "shortRetrySeconds": 60,
        "autoResumePrompt": "继续"
      }
    }
  }
}
```

Environment variable overrides: `OPEN_IM_AUTOPILOT` (true/false), `OPEN_IM_AUTOPILOT_MAX_RETRIES`.

Default: enabled, zero config needed.

### Slash Command

`/autopilot` — read-only status command showing:

- Whether autopilot is enabled
- Current configuration (max retries, default interval, short retry delay)
- Whether any task is currently waiting for a rate-limit reset

Added to `/help` output as: `/autopilot — 查看限流自动恢复状态`

### Enhanced Session Preservation

The existing `isUsageLimitError()` function in `ai-task.ts` is expanded to cover all rate-limit patterns (429, 529, overloaded, session limit, etc.). This ensures the session is preserved for ALL rate-limit scenarios, not just the current narrow `"usage limit"` pattern. This prevents the session from being unnecessarily reset when a rate limit occurs.

### What This Does NOT Do

- **No multi-account rotation** — out of scope
- **No task-level persistence** — WAL already covers message persistence; persisting in-flight retry timers is over-engineering
- **No per-adapter retry logic** — the shared interceptor handles all adapters
- **No Web Dashboard config panel** — first version uses config.json only
- **No retry of other adapters** — while the interceptor catches all adapters' errors, only the "send continue" recovery makes sense. Other adapters (Codex, CodeBuddy, OpenCode) benefit from session preservation but the "continue" prompt is Claude-specific. The `autoResumePrompt` could be made per-tool in the future.

### Risks and Edge Cases

1. **SDK error format changes**: Regex matching depends on error message formats. Fallback: unrecognized rate limits go through normal `onError` — no worse than current behavior.

2. **Long waits**: Session limits may require 5-hour waits. The open-im daemon must stay running. This is the natural advantage of daemon mode, but users should know not to `open-im stop`.

3. **Concurrent messages**: If the user sends a new message while a timer is pending, the new message enters the request queue. When the timer fires and enqueues "继续", it goes to the back of the queue. This is reasonable behavior.

4. **Process restart**: If open-im restarts during a pending timer, the timer is lost. Acceptable — the user just sends another message.

5. **Session expiry during wait**: The AI tool's session may expire during a long wait. When "继续" is sent, if the session is invalid, the existing `onSessionInvalid` handler auto-resets and starts fresh. The user's message is processed in a new session.

### Files Changed

| File | Change |
|---|---|
| `src/shared/ai-task.ts` | Rate-limit interceptor in `onError`, enhanced `isUsageLimitError()` |
| `src/config/types.ts` | Autopilot config types (FileConfig + Config) |
| `src/constants.ts` | Autopilot default constants |
| `src/config.ts` | Autopilot config resolution |
| `src/commands/handler.ts` | `/autopilot` slash command, `/help` update |

**No adapter files are modified.** No IM platform files are modified. No request queue or session manager changes.
