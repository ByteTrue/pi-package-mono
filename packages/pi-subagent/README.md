# @byte/pi-subagent

Claude Code-style **subagents** for the [pi coding agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent).

Delegate a self-contained task to an isolated specialist agent that runs with its own fresh
context, its own tool whitelist, and its own provider/model. The main agent picks a subagent by
its `description` and hands it a prompt; only the subagent's final message comes back. Everything
is driven through a single `Agent` tool plus a `/subagent` command, so it works over CLI/RPC without
relying on any TUI state switching.

This solves three gaps in vanilla pi:

1. **The main agent never delegates on its own.** The `Agent` tool ships with proactive guidelines
   (modeled on Claude Code) telling the model *when* to reach for a subagent.
2. **Subagents can't pick a provider/model.** Each agent runs on `inherit` (the main model) by
   default; set a specific `provider/model-id` per agent via `/subagent` or the config.
3. **No natural division of labor.** Three built-ins (`general-purpose`, `explore`, `plan`) mirror
   Claude Code's defaults; add your own as Markdown files.

> The delegation tool is named `Agent` to match Claude Code's current tool name. Nested delegation
> is intentionally disabled this release: every subagent runs with the `Agent` tool excluded, so a
> subagent can never spawn another subagent.

## Capabilities

| Surface | What it does |
|---|---|
| `Agent` tool | Delegate a task to a subagent. Args: `subagent_type` (which agent), `prompt` (the complete, self-contained task), optional `description` (3–5 word UI title). Returns the subagent's final message plus the model it ran on. |
| `/subagent` command | `/subagent` (no args) interactively configures a subagent's model — pick an agent, pick a model from the live registry (or `inherit`), and it's saved to the config. `/subagent --list` lists every subagent with its source, resolved model, and tools; `/subagent --show <name>` prints one agent's full details (file path, model, tools, description, system-prompt preview). List/show go through `ctx.ui.notify`; the picker uses `ui.select` — both work over CLI/RPC. |

## Install

```bash
pi install /absolute/path/to/pi-package-mono/packages/pi-subagent
```

## Built-in agents

| Name | Tools | Model | Use it for |
|---|---|---|---|
| `general-purpose` | all (inherited) | inherit | Open-ended, multi-step work that needs both investigation and edits; the fallback when nothing more specific fits. |
| `explore` | `read`, `grep`, `find`, `ls` (read-only) | inherit | Locating files, tracing how something is implemented, answering "where is X / how does Y work". Fast and non-destructive. |
| `plan` | `read`, `grep`, `find`, `ls` (read-only) | inherit | Turning a goal into a concrete, ordered implementation plan (which files to change, in what order, with what risks) without editing code. |

Built-ins are the lowest precedence — a user or project file with the same `name` overrides them
(e.g. drop an `explore.md` in `./.pi/subagents` to give the project its own explorer).

## Agent files

Subagents are Markdown files: YAML frontmatter + a body that becomes the subagent's system prompt.

```markdown
---
name: reviewer
description: Reviews a diff for correctness and style. Use proactively before committing.
tools: read, grep, find, ls
disallowedTools: write, edit, bash
model: inherit
color: cyan
---
You are a code-review subagent. Read the changed files, then return a concise list of
concrete issues (file path + line + problem + suggested fix). Do not modify anything.
```

### Frontmatter fields

| Field | Required | Format | Meaning |
|---|---|---|---|
| `name` | yes | string | The subagent's identity — this is what `subagent_type` matches. Taken from frontmatter, **not** the file name. |
| `description` | yes | string | Routing hint the main agent reads to decide when to delegate. Write it proactively ("Use proactively to…", "MUST BE USED for…"). |
| `tools` | no | comma-separated | Allowlist of tool names. Omitted ⇒ inherit pi's full default tool set. Built-in tool names: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`. |
| `disallowedTools` | no | comma-separated | Denylist, subtracted from whatever is enabled. The `Agent` tool is always denied regardless. |
| `model` | no | string | Model spec — see below. Omitted ⇒ `inherit`. |
| `color` | no | string | Optional UI accent color name. |

Both `tools` and `disallowedTools` are split on commas and trimmed; an empty/whitespace-only
`tools` is treated as "unset" (inherit all). A file missing `name` or `description` is skipped with
a diagnostic — it never crashes loading.

### Discovery & precedence

Agent files are discovered **recursively** from (kept under `subagents/` to avoid colliding with
pi's own `~/.pi/agent` config dir):

- `~/.pi/subagents/**/*.md` — **user** tier (your personal agents, available everywhere).
- `./.pi/subagents/**/*.md` — **project** tier (resolved against the working directory).

On a `name` collision the highest tier wins:

```
project  >  user  >  built-in
```

## Model specs

The `model` field (in frontmatter, or overridden in config) accepts:

| Spec | Resolves to |
|---|---|
| omitted / `inherit` | The main agent's current model — the subagent runs on whatever you're using. This is the default for all built-ins. |
| `provider/model-id` | An exact model looked up via the registry, e.g. `bytetrueapi/deepseek-v4-flash`, `anthropic/claude-opus-4-5`, `google/gemini-2.5-pro`. Set it interactively with `/subagent`, or in the config. |

There are no model aliases (no `opus`/`sonnet` shorthand): a name without a `provider/` prefix is
ambiguous across providers, so use the exact `provider/model-id`. Resolution is **fail-soft**: a
missing `provider/model-id` or any unrecognized token falls back to the main agent's model and
reports a one-line warning (surfaced in the `Agent` result and in `/subagent`). A bad model spec never
breaks delegation.

The subagent shares the parent's `ModelRegistry`, so credentials/providers are reused — you don't
re-authenticate per subagent.

## Configuration

Optional per-agent overrides live in `~/.pi/byte-pi-subagent/config.json` (override the base dir with
`PI_CONFIG_DIR`). Config **wins over** a file's frontmatter, which in turn wins over the built-in
defaults. It's fail-soft: malformed JSON or a schema violation degrades to "no overrides" and never
blocks startup.

```jsonc
{
  "agents": {
    // Run the read-only explorer on a cheap fast model:
    "explore": { "model": "bytetrueapi/deepseek-v4-flash" },

    // Pin planning to a specific provider/model:
    "plan": { "model": "anthropic/claude-opus-4-5" },

    // Tighten general-purpose: explicit allowlist + extra denylist:
    "general-purpose": {
      "model": "inherit",
      "tools": "read, grep, find, ls, edit, write",
      "disallowedTools": "bash"
    }
  }
}
```

Each entry under `agents` is keyed by the agent's `name` and may set `model`, `tools`, and/or
`disallowedTools` (same formats as the frontmatter). Only the fields you list are overridden.

## Writing good delegation prompts

A subagent **cannot see the main conversation** — its `prompt` is its only input. Make it
self-contained: state the goal, the relevant absolute file paths, any background it needs, and
exactly what to return as the final answer (the caller only gets the final message, not the
intermediate steps).
