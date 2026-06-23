# Implementation Plan

1. Inspect mono repo package conventions.
2. Add new workspace package `packages/pi-subagents-plus`.
3. Implement small modules:
   - agent discovery
   - conservative frontmatter patching
   - backup/reset helpers
   - `/agents-plus` command registration
4. Use embedded gotgenes built-in templates only when creating a missing override, and never overwrite an existing override.
5. Add focused tests for frontmatter patch/reset behavior.
6. Validate:
   - `npm --workspace @bytetrue/pi-subagents-plus test`
   - `npm --workspace @bytetrue/pi-subagents-plus run typecheck`

## Done When

`/agents-plus` can configure model/thinking by patching agent markdown safely, and reset built-in overrides by backing up files.
