# @bytetrue/pi-subagent

Lightweight, high-performance Subagent runner for [Pi coding agent](https://pi.dev).

Spawns focused child agents in isolated sessions for delegating tasks, code reviews, or investigations. Every call returns at once; the parent agent keeps working (or ends its turn) and the full result arrives as a new message. Live progress, token & cost tracking sit in the status bar and the `/subagent` menu. One call = one subagent; to run several at once, the model makes multiple `subagent` calls in the same message.

## Features

- **⚡️ Zero Bloat & Minimal Context**: Three lightweight tool schemas (~200 tokens) replace heavy multi-thousand-token multi-agent frameworks.
- **🎭 Built-in Golden Roles**: `explore`, `plan`, and `general-purpose` ship as ordinary agent documents in `agents/` — copy one into `.pi/agents/` to customise it. The role design mirrors Claude Code's built-in subagents, ported from [@tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents) (MIT).
  - `explore`: Fast read-only code search and reconnaissance (`read, grep, find, ls, bash`, lowest thinking level).
  - `plan`: Read-only implementation planning; ends every report with a `### Critical Files for Implementation` list.
  - `general-purpose`: Full toolset for multi-step work — what omitting `agent` already gives you, available as an explicit role name.
- **🛡️ Runaway Guardrails**: Default 20-minute timeout and 50-turn limit prevent infinite loops or burning quota.
- **🔄 Pi-native Session Resumption**: Subagents assign clean project session IDs; paused or completed sessions can be resumed with `resume: "<sessionId>"`.
- **🚀 Always Non-blocking**: The tool call returns a task id immediately; the parent turn is never held. The complete output is delivered as a follow-up message that starts the next turn.
- **🎛️ Full Control Loop**: `subagent_status` checks a task (status, activity, recent tools, session log path); `subagent_stop` stops one — idempotent, session-scoped, mirroring the background-terminal run/status/kill trio.
- **📊 Progress Where It Belongs**: The footer shows `sub:N · <role> <elapsed>` for the oldest running task; `/subagent → task → View Progress` shows the detailed card (duration, thinking intent, tool traces with arguments, token usage, cost).
- **⚙️ `/subagent` Interactive Menu**:
  - **Task Monitor**: View currently running, paused, and recent subagent tasks, inspect progress or output, or stop running tasks.
  - **Fuzzy Model Search**: Model picker with real-time text filter and wrap-around keyboard navigation (Up at top loops to bottom).
  - **Back Navigation**: Pressing `Esc` in any sub-menu smoothly returns to the parent menu level.
  - **Role & Default Config**: Configure global/project default models, thinking levels, and per-role overrides (built-in `explore`, `plan`, `general-purpose` or custom).

## Installation

```bash
pi install npm:@bytetrue/pi-subagent
```

Or run directly from this repository:

```bash
pi -e packages/pi-subagent/src/index.ts
```

## Interactive Configuration (`/subagent`)

Run `/subagent` in the Pi TUI to interactively:
- **View Active Subagents**: Browse all active/recent subagent tasks in the current session, view output, stop running tasks, or see resume instructions.
- **Set default subagent model and thinking level**: Use real-time fuzzy search to pick models across all configured providers with wrap-around cursor movement (`Esc` to go back).
- **Configure specific roles**: Customize `explore`, `plan`, `general-purpose`, or any custom role with dedicated model and thinking overrides.
- **Run `/subagent list` or `/subagent show`**: View effective configurations and discovered agent templates.

## Settings Files

Subagent configuration lives in this package's own file, not in pi's `settings.json`:

- Global: `<pkg-config root>/pi-subagent/settings.json`, where `<pkg-config root>` is `$PI_PKG_CFG_DIR` or `<agent dir>/pi-pkg-cfg` (`<agent dir>` is `$PI_CODING_AGENT_DIR` or `~/.pi/agent`).
- Project: `<project>/.pi/pi-pkg-cfg/pi-subagent/settings.json`, only written when you pick the project scope in `/subagent` and the project is trusted.

The file holds the section directly:

```json
{
  "defaultModel": "bytetrueapi/gemini-3.7-flash",
  "agents": {
    "reviewer": { "model": "bytetrueapi/qwen3.8-max", "thinking": "high" }
  }
}
```

Upgrading from 0.9.x: an existing `subagent` section in pi's `settings.json` (or the older `subagents.agentOverrides` shape) is copied whole into the new file the first time it is read or written, and pi's `settings.json` is left untouched so you can roll back. A legacy file that is still the live one is reported as `legacy (read-only fallback): <path>`. Project-level sections in `<project>/.pi/settings.json` are read but never rewritten; they keep applying until you delete them.

## Tool Reference

### `subagent`

Delegate ONE task to an isolated child agent session. The call always returns at once with a task id; the result arrives later as a new message. To run several tasks at once, make multiple `subagent` calls in the same message — each gets its own task id, progress card, and completion notice.

Note: in print mode (`pi -p`, `--mode json`) the process exits after one turn, so a subagent started there has no next turn to report to. Pure background is the only mode by design (issue 088).

#### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `task` | `string` | **Yes** | The task instruction / prompt. |
| `agent` | `string` | No | Optional role. **Omit it for a general-purpose child** that inherits your model, thinking level, and pi's default tools (`read, bash, edit, write`). Built-ins: `explore` (fast read-only search), `plan` (read-only implementation planning), `general-purpose` (full tools, multi-step work); any custom `.pi/agents/<name>.md` works too. **A name matching no document is rejected** with the list of available roles rather than silently degrading to the general-purpose child. |
| `tools` | `string[]` | No | Optional tool allowlist (e.g. `["read", "grep", "find"]`). |
| `cwd` | `string` | No | Optional working directory for the task. |
| `resume` | `string` | No | Resume a previous subagent session (session id or partial UUID). |
| `timeoutMs` | `number` | No | Timeout in ms. Default: 1200000 (20 minutes). |
| `maxTurns` | `number` | No | Turn limit before pausing. Default: 50. |

#### Usage Example

General-purpose child — omit `agent`:

```json
{ "task": "Dogfood the new onboarding flow and report what breaks" }
```

A built-in role, when one matches exactly:

```json
{
  "agent": "plan",
  "task": "Plan how to add retry handling to packages/pi-subagent/src/index.ts"
}
```

Parallel fanout is just several calls in one message:

```json
[{ "agent": "explore", "task": "Locate relevant test and config files" },
 { "agent": "plan", "task": "Draft the implementation plan for the located files" }]
```

### `subagent_status`

Check one subagent task by id: status, elapsed time, current activity (running tool, turns, token/cost, model), recent tool calls, and the child session log path — the model can `read` that file for the full behaviour history. The task's output is never included here; it is delivered automatically as a new message when the task completes, so there is no reason to poll.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | **Yes** | Task id from the `subagent` call. |

### `subagent_stop`

Stop a running subagent task by id. Idempotent: stopping an already-finished task reports its status instead of failing. Tasks from other sessions are not visible. A cancellation notice still arrives as a new message.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | **Yes** | Task id from the `subagent` call. |


#### Built-in roles

The child is general-purpose by default: omitting `agent` inherits your model, thinking level, and pi's default toolset. The built-in roles — `explore`, `plan`, `general-purpose` — mirror Claude Code's built-in subagents (design ported from [@tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents), MIT): two are strictly read-only, one is the full-toolset catch-all. They are ordinary agent documents shipped in the package's `agents/` directory, parsed by the same code as your own `.pi/agents/*.md`, and a file with the same name wins over the packaged one. Copy one out to customise it:

```bash
mkdir -p .pi/agents && cp node_modules/@bytetrue/pi-subagent/agents/explore.md .pi/agents/explore.md
```

```markdown
---
model: your-provider/your-model
---
```

A document replaces the built-in entirely, so keep the fields you still want — `tools` in particular. Omitting `tools` leaves the child on pi's default set (`read, bash, edit, write`).

#### Extension tools and role documents

`--tools` is an **allowlist that replaces the default selection**, so a role that names its own `tools:` receives only those names — extension tools are not added on top. The built-in `explore` and `plan` documents deliberately name only pi's read-only core (`read, grep, find, ls, bash`); they do **not** bake in another extension's tool names. `general-purpose` omits `tools:` entirely, so that child inherits pi's full default set, extension tools included.

If you want a read-only child to also carry an extension's tool (for example the context tools from [billion-context-pi](https://github.com/ranxianglei/billion-context-pi)), add them through settings rather than editing a packaged document: an older billion-context-pi's `/acp-subagents <package-dir>` writes a combined tool list to `subagents.agentOverrides.<role>.tools`, which this extension reads as a per-role override. Note that an override **replaces** the document's `tools:`, so it must list the role's full baseline, not just the additions.

#### Environment pass-through

The reverse is just as common: an extension registers tools into *every* pi process, including children, where they may not work. `subagent.env` passes extra environment variables to every child, so you can switch such an extension off for children without this package knowing anything about it.

```json
{
  "subagent": {
    "env": {
      "BILLION_CONTEXT_PLUGIN": "0"
    }
  }
}
```

- Read from both `.pi/settings.json` (project) and `~/.pi/agent/settings.json` (global); project keys win on conflict, unset keys are kept from global.
- Values must be strings — numbers and booleans are ignored rather than silently coerced, so a switch that tests for `"0"` cannot be handed a `0`.
- `PI_SUBAGENT_CHILD` is applied **after** your values and is not overridable: it is this extension's recursion guard, and a child that lost it would load this extension again and recurse.
- This is a plain pass-through. Unrelated to the env, the child still inherits the parent's environment as before.

#### Model and Thinking Resolution

The Agent-facing tool deliberately does not expose model or thinking overrides. These execution-policy choices remain under user control through `/subagent`, settings, and agent documents.

The model priority chain is:

1. `agents[role].model` — per-role binding (settings file)
2. An agent document — `.pi/agents/<name>.md`, `<agentDir>/agents/<name>.md`, or the packaged built-in
3. `defaultModel` — explicit subagent default (settings file)
4. Parent session's current fully qualified provider/model (inherited)
5. The child `pi` process's own default

Thinking follows the same user-controlled chain: role settings, agent document, subagent default, then the parent session. `explore` asks for the lowest available thinking level; `plan` and `general-purpose` set none, so they inherit the parent session.

Root-level pi settings `defaultProvider`/`defaultModel`/`defaultThinkingLevel` are deliberately **not** consulted — unset subagent configuration means "inherit".

## License

MIT

### Attribution

The built-in agent prompts in `agents/` (`explore`, `plan`, `general-purpose`) are adapted from [@tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents), which is MIT licensed — Copyright (c) 2026 tintinweb. That project in turn mirrors the role design of Claude Code's built-in subagents.
