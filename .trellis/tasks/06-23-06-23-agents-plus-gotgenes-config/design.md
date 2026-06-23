# Design

## Scope

Create a companion Pi extension package that only owns `/agents-plus` and file-level configuration helpers. It does not modify gotgenes internals.

## Approach

- Discover agent markdown files from:
  - project: `<cwd>/.pi/agents/*.md`
  - global: `<agentDir>/agents/*.md`, where `agentDir` comes from Pi SDK `getAgentDir()` if available
- Treat gotgenes built-ins as known names for MVP:
  - `general-purpose`
  - `Explore`
  - `Plan`
- For custom/ejected agents, patch YAML frontmatter in place.
- For built-ins without a file, create a project override only after user confirmation.
- Reset to default renames the project/global override to `*.bak-YYYYMMDD-HHMMSS`.

## Minimal UI

`/agents-plus` uses existing `ctx.ui.select`, `ctx.ui.confirm`, and `ctx.ui.notify` primitives instead of custom TUI components.

Flow:

1. Select action: Configure model, Configure thinking, Reset built-in override.
2. Select agent.
3. For model: select `inherit` or one model from `ctx.modelRegistry`/known model list if exposed; fallback to text input.
4. For thinking: select one literal level.
5. Patch file / create override / backup reset.

## Frontmatter Patch Contract

- Preserve body exactly.
- Preserve unrelated frontmatter lines best-effort.
- Set or replace only the target key.
- If no frontmatter exists, prepend one.

This avoids adding YAML dependencies for MVP. If gotgenes/agent files use complex YAML that the tiny patcher cannot safely preserve, return a clear warning and do nothing.

## Built-in Override Creation

MVP built-in templates should be deliberately minimal and safe:

```markdown
---
description: <known description>
model: inherit
---

<short placeholder prompt explaining this override was created by agents-plus>
```

But because overriding a built-in prompt changes behavior, the command must confirm before creating it. Existing files are never overwritten.

## Risks

- Gotgenes built-in prompt drift: reset should prefer moving overrides away rather than rewriting current defaults.
- Pi modelRegistry shape may differ: keep model picker defensive and allow manual input.
- Frontmatter formatting edge cases: keep patcher conservative.
