# Agents Plus for gotgenes subagents

## Goal

Add a small non-invasive companion extension for `@gotgenes/pi-subagents` that improves configuration UX without forking or modifying gotgenes runtime code.

## User Value

A user can keep using gotgenes' full subagent runtime/UI, but configure per-agent model and thinking from a Pi slash command instead of manually opening and editing agent markdown files.

## Requirements

- Provide a new package/extension in this mono repo, tentatively `@bytetrue/pi-subagents-plus`.
- Register `/agents-plus`.
- `/agents-plus` MVP offers simple actions:
  - configure an agent's model
  - configure an agent's thinking level
  - reset a built-in override to gotgenes default
- Do not fork, patch, or import gotgenes private source internals.
- Prefer public/runtime-safe integration only:
  - discover gotgenes agent markdown files from `.pi/agents` and `~/.pi/agent/agents`
  - optionally use `@gotgenes/pi-subagents` public service only if needed
- For existing custom/ejected agent markdown files, update only YAML frontmatter fields `model` and/or `thinking`; preserve body prompt and unrelated frontmatter.
- For gotgenes built-in agents with no markdown override, ask before creating a project override markdown file.
- Never overwrite a user's existing agent body prompt when changing model/thinking.
- Reset to default must not delete user content silently; move the override file to a timestamped backup.
- Keep implementation small and dependency-light.

## Acceptance Criteria

- [ ] `/agents-plus` appears as a Pi command.
- [ ] A user can pick an existing agent markdown file and set `model` without editing markdown manually.
- [ ] A user can set `thinking` to `off|minimal|low|medium|high|xhigh`.
- [ ] Updating model/thinking preserves the markdown body and unrelated frontmatter.
- [ ] Built-in override creation requires confirmation and does not overwrite existing files.
- [ ] Reset moves an override file to a backup path and lets gotgenes built-in defaults apply again.
- [ ] Tests cover frontmatter patching and backup/reset behavior.

## Out of Scope

- Reimplementing gotgenes runtime, widget, background agents, transcript viewer, steer, or get-result tools.
- Replacing gotgenes `/agents`.
- Forking gotgenes.
- Automatically refreshing or overwriting built-in prompts from upstream.
- Full agent creation wizard.
