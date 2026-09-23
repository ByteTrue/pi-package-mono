# @bytetrue/pi-subagent

Lightweight, high-performance Subagent runner for [Pi coding agent](https://pi.dev).

Spawns focused child agents in isolated sessions for delegating tasks, code reviews, or investigations. Every call returns at once; the parent agent keeps working (or ends its turn) and the full result arrives as a new message. Live progress, token & cost tracking sit in the status bar and the `/subagent` menu. One call = one subagent; to run several at once, the model makes multiple `subagent` calls in the same message.

## Features

- **⚡️ Zero Bloat & Minimal Context**: Three lightweight tool schemas (~200 tokens) replace heavy multi-thousand-token multi-agent frameworks.
- **🎭 Built-in Golden Roles**: `scout`, `researcher`, and `reviewer` ship as ordinary agent documents in `agents/` — copy one into `.pi/agents/` to customise it.
  - `scout`: Fast read-only codebase reconnaissance (`read, grep, find`, lowest thinking level).
  - `researcher`: Autonomous web & technical documentation research (`read, grep, find, web_search, web_fetch`, inherits the parent session's thinking level).
  - `reviewer`: Disciplined adversarial code review and test validation (`read, grep, find, bash`, highest thinking level).
- **🛡️ Runaway Guardrails**: Default 20-minute timeout and 50-turn limit prevent infinite loops or burning quota.
- **🔄 Pi-native Session Resumption**: Subagents assign clean project session IDs; paused or completed sessions can be resumed with `resume: "<sessionId>"`.
- **🚀 Always Non-blocking**: The tool call returns a task id immediately; the parent turn is never held. The complete output is delivered as a follow-up message that starts the next turn.
- **🎛️ Full Control Loop**: `subagent_status` checks a task (status, activity, recent tools, session log path); `subagent_stop` stops one — idempotent, session-scoped, mirroring the background-terminal run/status/kill trio.
- **📊 Progress Where It Belongs**: The footer shows `sub:N · <role> <elapsed>` for the oldest running task; `/subagent → task → View Progress` shows the detailed card (duration, thinking intent, tool traces with arguments, token usage, cost).
- **⚙️ `/subagent` Interactive Menu**:
  - **Task Monitor**: View currently running, paused, and recent subagent tasks, inspect progress or output, or stop running tasks.
  - **Fuzzy Model Search**: Model picker with real-time text filter and wrap-around keyboard navigation (Up at top loops to bottom).
  - **Back Navigation**: Pressing `Esc` in any sub-menu smoothly returns to the parent menu level.
  - **Role & Default Config**: Configure global/project default models, thinking levels, and per-role overrides (built-in `scout`, `researcher`, `reviewer` or custom).

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
- **Configure specific roles**: Customize `scout`, `researcher`, `reviewer`, or any custom role with dedicated model and thinking overrides.
- **Run `/subagent list` or `/subagent show`**: View effective configurations and discovered agent templates.

## Tool Reference

### `subagent`

Delegate ONE task to an isolated child agent session. The call always returns at once with a task id; the result arrives later as a new message. To run several tasks at once, make multiple `subagent` calls in the same message — each gets its own task id, progress card, and completion notice.

Note: in print mode (`pi -p`, `--mode json`) the process exits after one turn, so a subagent started there has no next turn to report to. Pure background is the only mode by design (issue 088).

#### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `task` | `string` | **Yes** | The task instruction / prompt. |
| `agent` | `string` | No | Optional role. **Omit it for a general-purpose child** that inherits your model, thinking level, and pi's default tools (`read, bash, edit, write`). Built-ins: `scout` (read-only recon), `researcher` (web/doc research), `reviewer` (code review & tests); any custom `.pi/agents/<name>.md` works too. **A name matching no document is rejected** with the list of available roles rather than silently degrading to the general-purpose child. |
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
  "agent": "reviewer",
  "task": "Review packages/pi-subagent/src/index.ts for potential edge cases"
}
```

Parallel fanout is just several calls in one message:

```json
[{ "agent": "scout", "task": "Locate relevant test and config files" },
 { "agent": "reviewer", "task": "Perform adversarial review on the located files" }]
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

The child is general-purpose by default: omitting `agent` inherits your model, thinking level, and pi's default toolset. The built-in roles — `scout`, `researcher`, `reviewer` — are opt-in presets for jobs that match them exactly. They are ordinary agent documents shipped in the package's `agents/` directory, parsed by the same code as your own `.pi/agents/*.md`, and a file with the same name wins over the packaged one. Copy one out to customise it:

```bash
mkdir -p .pi/agents && cp node_modules/@bytetrue/pi-subagent/agents/scout.md .pi/agents/scout.md
```

```markdown
---
model: your-provider/your-model
---
```

A document replaces the built-in entirely, so keep the fields you still want — `tools` in particular. Omitting `tools` leaves the child on pi's default set (`read, bash, edit, write`).

#### Model and Thinking Resolution

The Agent-facing tool deliberately does not expose model or thinking overrides. These execution-policy choices remain under user control through `/subagent`, settings, and agent documents.

The model priority chain is:

1. `subagent.agents[role].model` — per-role binding (settings)
2. An agent document — `.pi/agents/<name>.md`, `<agentDir>/agents/<name>.md`, or the packaged built-in
3. `subagent.defaultModel` — explicit subagent default (settings)
4. Parent session's current fully qualified provider/model (inherited)
5. The child `pi` process's own default

Thinking follows the same user-controlled chain: role settings, agent document, subagent default, then the parent session. scout asks for the lowest available thinking level and reviewer the highest; researcher sets none, so it inherits the parent session.

Root-level pi settings `defaultProvider`/`defaultModel`/`defaultThinkingLevel` are deliberately **not** consulted — unset subagent configuration means "inherit".

## License

MIT
