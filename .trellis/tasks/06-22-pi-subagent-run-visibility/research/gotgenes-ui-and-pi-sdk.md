# Gotgenes UI And Pi SDK Research

## User Problem

The current `@bytetrue/pi-subagent` Agent tool does not make a subagent run observable enough. Users cannot tell which model was used, which thinking level was used, or what the child agent is doing while it runs.

## Reference: gotgenes/pi-packages

Repository inspected at `https://github.com/gotgenes/pi-packages` commit `57066062733d80b9b553410f8da6cdddc3658e1c`.

Relevant files:

- `packages/pi-subagents/README.md`
- `packages/pi-subagents/src/ui/display.ts`
- `packages/pi-subagents/src/ui/message-formatters.ts`
- `packages/pi-subagents/src/observation/renderer.ts`
- `packages/pi-subagents/src/handlers/tool-start.ts`

Useful UI patterns to borrow:

- Running subagents render a compact status line with agent type, description, turns, tool uses, tokens, duration, and activity.
- Per-run config is visible through model and tags such as `thinking: high`, background mode, and max turns.
- Activity text is derived from active tool names: reading, searching, editing, running command, etc.
- Result rendering uses a concise success/error line plus a short result preview.

Patterns intentionally out of scope for this task:

- Background subagent queue.
- Persistent widget above the editor.
- Conversation viewer.
- Steering/resume APIs.
- Token and context percentage metrics unless already available from the current child session events with no extra lifecycle system.

## Current Local Implementation

Relevant local files:

- `packages/pi-subagent/src/tools.ts`
- `packages/pi-subagent/src/runner.ts`
- `packages/pi-subagent/src/types.ts`
- `packages/pi-subagent/src/config.ts`
- `packages/pi-subagent/src/loader.ts`
- `packages/pi-subagent/src/tools.test.ts`
- `packages/pi-subagent/src/runner.test.ts`

Confirmed facts:

- `renderCall` currently shows only `Agent <subagent_type> - <title>`.
- Partial progress currently renders as only `Running subagent...`.
- `runSubagent` has an `onProgress` callback, but it only emits `<profile.name>: turn complete` on `agent_end`.
- Final result details include `provider`, `model`, and optional `warning`, but no thinking level.
- `AgentProfile` supports `model`, but not `thinking`.
- `Agent` tool parameters only include `subagent_type`, `prompt`, and optional `description`.

## Pi SDK Findings

Relevant pi SDK docs and types:

- `docs/sdk.md`
- `docs/extensions.md`
- `dist/core/sdk.d.ts`
- `dist/core/agent-session.d.ts`
- `dist/core/extensions/types.d.ts`

Confirmed APIs:

- `createAgentSession({ thinkingLevel })` accepts `off`, `minimal`, `low`, `medium`, `high`, or `xhigh`.
- `AgentSession.thinkingLevel` exposes the effective child session thinking level.
- `AgentSession.subscribe()` receives `tool_execution_start`, `tool_execution_end`, `turn_start`, `turn_end`, `message_update`, and `agent_end` events.
- `ExtensionAPI.getThinkingLevel()` returns the parent session's active thinking level.

## Recommended MVP

Implement foreground run observability only:

- Add `thinking` support to profile frontmatter and config overrides.
- Inherit the parent thinking level by default using `pi.getThinkingLevel()`.
- Pass the effective thinking level into `createAgentSession`.
- Return the effective thinking level in `RunResult` and Agent result details.
- Emit progress updates on child session lifecycle/tool events.
- Render partial Agent results with model, thinking, and latest activity.
- Keep the final result line concise: finished/failed + provider/model + thinking + warning if any.
