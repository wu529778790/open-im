# Native Interaction Bridge Design

## Goal

Align open-im with a bridge-first product model: preserve the AI tool's native interaction semantics over IM instead of inventing a unified open-im approval or choice protocol. In the first phase, implement native interaction bridging for Claude SDK only, while keeping Codex, CodeBuddy, and OpenCode in their current open execution mode.

## Product Principle

open-im is a transport and adaptation layer, not the authority that defines how an AI must ask for confirmation, present numbered options, or request follow-up input.

The default rule is:

- If the underlying AI can express a native interaction through the bridge, open-im should forward it.
- If the underlying AI cannot reliably do that, open-im should avoid pretending it can and should keep the current behavior.

This keeps the product closer to a terminal-equivalent conversation flow without forcing one synthetic protocol across different tools.

## Current Problems

- The current task model in `src/shared/ai-task.ts` is optimized for single-run execution, not for conversation-style interaction where the AI asks and the user replies in the same live context.
- Tool adapters expose streaming callbacks such as `onText`, `onThinking`, `onToolUse`, and `onComplete`, but they do not describe whether a tool supports native interactive follow-up versus only resumable multi-turn execution.
- The system is currently permissive by default through `skipPermissions`, which is workable for fully automatic tools but does not reflect the product direction for tools that can express native confirmation flows.
- Existing choice handling, such as Telegram number buttons, is presentation enhancement only. It does not yet formalize a bridge model for native AI-led interaction.

## Chosen Direction

Phase 1 adopts a capability-driven bridge:

1. Claude SDK is treated as the first native-interaction tool.
2. Codex, CodeBuddy, and OpenCode remain in open execution mode.
3. open-im does not introduce its own approval state machine or repo/global allow system in this phase.
4. User replies such as `1`, `2`, `yes`, or free-form clarifications are treated as ordinary follow-up input to the same AI conversation when the tool supports it.

This is a semantic bridge, not a terminal UI clone. IM presentation may differ from a shell, but the interaction meaning should remain equivalent.

## Interaction Model

### Semantic Consistency

The target is not to reproduce the terminal's raw prompt formatting, cursor behavior, or TTY-level interaction. The target is to preserve the same meaning:

- the AI asks a question
- the user answers in IM
- the answer returns to the same AI conversation
- the AI continues from that conversation state

This is sufficient for option selection, confirmation, clarification, and other normal interactive turns.

### Native Over Synthetic

When Claude asks the user to choose between options or confirm an action, open-im should not replace that with an open-im-defined protocol. It should simply deliver Claude's message and send the user's reply back into Claude's conversation.

Platform-specific UI affordances such as Telegram inline buttons are allowed only as a view-layer enhancement. They must preserve the same reply payload the user would have typed manually.

## Capability Classes

The system should classify adapters by interaction capability rather than by implementation technology such as SDK versus CLI.

### `native`

The tool can support AI-led conversation semantics over IM. The AI can ask a question, the user can respond, and the response can continue the same conversation in a stable way.

This does not require a literal paused TTY. It requires reliable conversational continuity.

### `open`

The tool runs in a permissive automatic mode and does not claim native interaction bridging support. The bridge may still stream output and resume sessions where supported, but it does not promise terminal-equivalent native confirmation behavior.

Phase 1 intentionally supports only these two classes. No finer-grained approval mode is introduced yet.

## Tool Mapping for Phase 1

### Claude SDK: `native`

Claude SDK already has the strongest session and streaming model in the current codebase:

- session discovery and resume support
- structured streaming messages
- assistant tool-use visibility
- conversation continuity through the SDK query flow

Because of this, Claude is the correct first target for native interaction bridging.

### Codex: `open`

The current Codex runner in `src/codex/cli-runner.ts` is still a one-request execution shape: prompt is written to stdin and stdin is then closed. Although resume exists, the system does not yet model Codex as a native interactive bridge. Phase 1 should keep Codex permissive and automatic.

### CodeBuddy: `open`

The current CodeBuddy runner streams structured output and supports `--resume`, but the integration shape is still single-turn execution plus later continuation. Phase 1 should keep CodeBuddy in open mode.

### OpenCode: `open`

The current OpenCode SDK integration uses `session.prompt(...)` with event streaming. It has session continuity but not a bridge contract that should be marketed as native IM interaction. Phase 1 should keep it in open mode.

## Message Flow

### Claude Native Flow

1. User sends a message in IM.
2. open-im routes to Claude SDK.
3. Claude streams text, thinking, and other assistant output as it does today.
4. If Claude ends the turn with a question, numbered options, or a request for confirmation, that content is delivered as normal assistant output.
5. The next user reply in the same chat is treated as the next Claude turn for the same conversation.
6. open-im resumes or continues the existing Claude conversation instead of starting a synthetic side protocol.

The important constraint is that open-im does not reinterpret the reply as a platform command unless it is actually an open-im command such as `/new` or `/resume`.

### Open Tools Flow

For Codex, CodeBuddy, and OpenCode:

1. User sends a message in IM.
2. open-im runs the tool using the current open automatic behavior.
3. Output is streamed and the task completes normally.
4. If the user sends a follow-up message later, it is handled according to the current session behavior of that adapter, but the product does not promise native interactive authorization semantics.

## Required Code Changes

### Adapter Capability Declaration

`src/adapters/tool-adapter.interface.ts` should declare the interaction mode for each adapter, so the task layer can reason about product behavior explicitly instead of inferring it from tool identity.

Recommended direction:

- add a readonly adapter capability field such as `interactionMode: 'native' | 'open'`

This is intentionally small and product-facing.

### Claude Bridge Path

`src/adapters/claude-sdk-adapter.ts` remains the first-class native bridge implementation.

The task layer should treat Claude follow-up input as normal continuation of the same conversation. The adapter should not be wrapped in an open-im approval broker in this phase.

### Task Layer Adjustment

`src/shared/ai-task.ts` should stop assuming every run is a fire-and-forget task with no AI-led follow-up semantics.

Phase 1 does not require a large rewrite into a fully paused runtime. It does require the task layer to preserve the mental model that the user's next reply may belong to the same Claude-native interaction.

### Platform Presentation

Platform handlers should preserve the bridge rule:

- Telegram may convert detected numbered options into inline buttons, but button taps must send the same number reply the user would have sent manually.
- Other platforms may stay text-only.
- No platform should introduce a new open-im-specific approval vocabulary for Claude native interaction.

## Non-Goals

- No unified approval broker
- No repo-scoped or global allow policy store
- No synthetic `y / n / stop / always / global` permission system
- No claim that Codex, CodeBuddy, or OpenCode support native interactive authorization over IM
- No terminal UI mirroring or PTY cloning
- No attempt to normalize all tool behaviors into one approval contract

## Testing

- Claude conversations continue across follow-up replies in the same chat and work directory.
- A Claude message containing numbered options remains answerable by ordinary IM replies.
- Telegram choice buttons, where shown, send the same semantic reply as typed input.
- Existing Claude completion and error delivery remain intact.
- Codex, CodeBuddy, and OpenCode continue working in their current open execution mode without regression.
- `/new`, `/resume`, and other explicit open-im commands still take precedence over normal follow-up replies.

## Risks and Mitigations

- Risk: users may assume all AI tools support the same native interaction model.
  - Mitigation: keep the capability split explicit in code and management UI copy when this is later surfaced.

- Risk: the current task model may still contain single-run assumptions that break follow-up continuity.
  - Mitigation: keep the first implementation tightly scoped to Claude and verify session continuity before expanding to other tools.

- Risk: presentation enhancements such as Telegram buttons could drift from the bridge principle.
  - Mitigation: require all UI affordances to map back to the exact textual reply the user could have sent manually.

- Risk: future work could accidentally reintroduce an open-im-owned approval protocol.
  - Mitigation: codify the product principle in this design and keep native interaction as the default architectural bias.
