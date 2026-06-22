# Design

## Scope

This task improves foreground `Agent` tool observability for `@bytetrue/pi-subagent`. It does not add background agents, queueing, widgets, conversation viewers, steering, or transcript persistence.

## Current Data Flow

```text
Agent tool execute()
  -> loadProfiles(ctx.cwd)
  -> applyConfigOverrides(profile, readConfig())
  -> runSubagent({ profile, prompt, ctx, signal, onProgress })
  -> createAgentSession({ model, tools, excludeTools, ... })
  -> session.prompt(prompt)
  -> final text + model/provider details
  -> renderResult()
```

Problems:

- The child session is created without an explicit `thinkingLevel`.
- Progress events are flattened to one late `turn complete` string.
- Partial result rendering ignores available metadata and always says `Running subagent...`.
- `AgentProfile` and config do not carry `thinking`, so there is no truthful per-agent thinking setting to display.

## Proposed Data Flow

```text
Agent tool execute()
  -> effective profile = applyConfigOverrides(...)
  -> effective thinking = profile.thinking ?? pi.getThinkingLevel()
  -> runSubagent({ profile, inheritedThinkingLevel, ... })
      -> resolve model
      -> createAgentSession({ model, thinkingLevel, tools, excludeTools, ... })
      -> subscribe to child events
      -> emit RunProgress updates with model/thinking/activity/status
  -> final RunResult includes model/provider/thinking/warning/text
  -> renderResult() uses details for partial and final display
```

## Contracts

### ThinkingLevel

Add a local literal union to avoid a direct dependency on `@earendil-works/pi-agent-core`:

```ts
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
```

This is structurally assignable to the SDK's `ThinkingLevel` accepted by `createAgentSession`.

### AgentFrontmatter / AgentProfile

Add optional `thinking?: ThinkingLevel` to normalized profiles. Frontmatter accepts a string and normalizes it. Invalid values should be ignored with a diagnostic rather than crashing profile loading.

### Config Override

Allow per-agent config entries to set `thinking`. Invalid config values should be ignored for that field instead of invalidating the whole config file.

### RunOptions / RunResult

Add:

- `inheritedThinkingLevel?: ThinkingLevel`
- `RunResult.thinkingLevel: ThinkingLevel`
- progress updates carrying at least `status`, `activity`, `provider`, `model`, and `thinkingLevel`.

### AgentDetails

Extend tool result details with:

- `thinking?: ThinkingLevel`
- `activity?: string`
- `status?: "starting" | "running" | "completed" | "error"`

Keep existing `model`, `provider`, and `warning` fields.

## Progress Event Mapping

Use `session.subscribe()` inside `runSubagent`:

- `agent_start` -> `started`
- `turn_start` -> `turn <n> started`
- `tool_execution_start` -> `running <tool summary>`
- `tool_execution_end` -> `<tool summary> done` or `<tool summary> failed`
- `turn_end` -> `turn complete`
- `agent_end` -> `completed` or `retrying` when `willRetry` is true

Tool summaries should be best-effort and short. Examples:

- `read packages/foo.ts`
- `grep "AgentDetails"`
- `bash pnpm test`
- `edit packages/foo.ts`

If args are missing or unexpected, fall back to the tool name.

## Rendering

`renderCall` can stay close to the current compact line. `renderResult` should change:

- partial: `⠹ <type> · <provider>/<model> · thinking <level>\n⎿ <activity>`
- final success: `✓ Subagent finished (<provider>/<model> · thinking <level>)`
- final warning appends the existing warning text

ASCII fallback is acceptable if current theme/font handling does not favor symbols, but existing code already uses `✓`, so keep it consistent.

## Compatibility

- Existing profiles without `thinking` keep working and inherit the parent thinking level.
- Existing configs without `thinking` keep working.
- Existing callers of `runSubagent` need one optional field only.
- Existing `Agent` tool callers still receive the same final text content.

## Risks

- Event type shapes are SDK-owned. Keep event handling narrow and defensive.
- Too many `message_update` deltas would spam partial rendering. MVP should avoid streaming text deltas and only emit lifecycle/tool updates.
- If `pi.getThinkingLevel()` is unavailable in older SDK versions, omit `thinkingLevel` and render `inherit` or the child session's effective level after creation when available.
