# Implementation Plan

## Preconditions

- Task artifacts are reviewed and approved before `task.py start`.
- Implementation stays inside `packages/pi-subagent` unless tests/docs require otherwise.

## Steps

1. Add thinking types and normalization.
   - Update `src/types.ts` with `ThinkingLevel` and optional profile/frontmatter fields.
   - Add or reuse a tiny normalizer for valid levels.
   - Verify with loader/config tests.

2. Load and override thinking.
   - Update `src/loader.ts` to parse frontmatter `thinking`.
   - Update `src/config.ts` to accept per-agent `thinking` overrides and apply only valid values.
   - Update README frontmatter/config docs.

3. Pass effective thinking into child sessions.
   - Update `src/runner.ts` `RunOptions` with `inheritedThinkingLevel`.
   - Compute `thinkingLevel = profile.thinking ?? inheritedThinkingLevel`.
   - Pass `thinkingLevel` to `createAgentSession` when available.
   - Return `thinkingLevel` in `RunResult`.

4. Emit useful progress.
   - Replace the current `agent_end`-only progress tick with lifecycle/tool event summaries.
   - Keep progress updates short and defensive.
   - Avoid streaming every text/thinking delta in this MVP.

5. Render progress and final metadata.
   - Extend `AgentDetails` in `src/tools.ts`.
   - In `registerAgentTool`, get inherited thinking from `pi.getThinkingLevel()` and pass it to `runSubagent`.
   - Include model/provider/thinking/activity in partial `onUpdate` details.
   - Update `renderResult` partial and final rendering.

6. Update tests.
   - `runner.test.ts`: thinking level is passed to `createAgentSession`; progress emits tool/turn events; result includes thinking.
   - `tools.test.ts`: partial render includes model/thinking/activity; final render includes thinking; execute passes inherited thinking.
   - `loader.test.ts` / `config.test.ts`: thinking frontmatter/config parsing.

7. Validate.
   - `npm --workspace @bytetrue/pi-subagent test`
   - `npm --workspace @bytetrue/pi-subagent run typecheck`

## Rollback Points

- If SDK event typing is awkward, keep progress to `agent_start`, `turn_start`, `turn_end`, and `agent_end` only.
- If `pi.getThinkingLevel()` is absent in the installed SDK type surface, use optional access and preserve existing behavior.

## Done When

- Running Agent partial UI shows model, thinking, and latest activity.
- Final Agent result shows model and thinking.
- Thinking can be configured through profile/config and inherited by default.
- Tests and type-check pass for `@bytetrue/pi-subagent`.
