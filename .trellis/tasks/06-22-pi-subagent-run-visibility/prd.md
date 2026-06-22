# Improve pi-subagent run visibility

## Goal

Make foreground `@bytetrue/pi-subagent` runs understandable while they are running and after they finish. A user should be able to see the effective model, effective thinking level, and latest subagent activity without opening logs or guessing what the child session is doing.

## User Value

When the main agent delegates work, the user can trust the delegation because the UI shows who is running, on what model/thinking level, and what kind of work is happening now.

## Confirmed Facts

- The current `Agent` tool renders partial progress as only `Running subagent...`.
- `runSubagent` currently emits only one coarse progress tick on `agent_end`: `<profile.name>: turn complete`.
- Final `Agent` results include provider/model metadata, but partial/running UI does not surface it.
- The local profile/config contract supports per-agent `model`, but not per-agent `thinking`.
- Pi SDK supports child-session `thinkingLevel`, child `AgentSession.thinkingLevel`, and lifecycle/tool events through `session.subscribe()`.
- `ExtensionAPI.getThinkingLevel()` can provide the parent thinking level for default inheritance.
- The gotgenes reference UI emphasizes compact run metadata plus live activity text derived from tool/lifecycle events.

## Requirements

- Show the effective provider/model for an `Agent` run while it is running and when it finishes.
- Show the effective thinking level for an `Agent` run while it is running and when it finishes.
- Add real `thinking` support to subagent profiles/config so displayed thinking is not fabricated.
- Default subagent thinking should inherit the parent session thinking level when no agent-specific thinking is configured.
- Surface readable progress updates from the child session lifecycle, especially turn starts/ends and tool execution starts/ends.
- Keep the UI compact and text-only, matching the existing `renderCall` / `renderResult` extension surface.
- Preserve existing behavior for model resolution, tool allow/deny selection, cancellation, and final-answer return shape.

## Acceptance Criteria

- [x] A running `Agent` partial result displays the subagent type/name, provider/model, thinking level, and latest activity instead of only `Running subagent...`.
- [x] The final `Agent` result displays provider/model and thinking level, plus any model warning.
- [x] Agent Markdown frontmatter accepts `thinking: off|minimal|low|medium|high|xhigh`.
- [x] `~/.pi/byte-pi-subagent/config.json` per-agent overrides can set `thinking`.
- [x] `runSubagent` passes the effective thinking level to `createAgentSession`.
- [x] If no subagent thinking is configured, the child run uses the parent thinking level from `pi.getThinkingLevel()`.
- [x] Progress updates include at least child start, turn start/end, tool start/end, and completion/failure.
- [x] Existing tests pass, and new focused tests cover thinking inheritance/display plus progress update rendering.

## Out Of Scope

- Background subagent queue or persistent widget.
- Conversation viewer, steering, resume, transcript storage, or expandable history.
- Token/context usage metrics unless they fall out of existing events with no new lifecycle system.
- Replacing the current `Agent` tool with gotgenes' broader `subagent` tool surface.
