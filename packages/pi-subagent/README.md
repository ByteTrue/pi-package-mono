# @bytetrue/pi-subagent

Lightweight, high-performance Subagent runner for [Pi coding agent](https://pi.dev).

Spawns focused child agents in isolated sessions for delegating tasks, background work, code reviews, or investigations, complete with real-time TUI progress streaming, token & cost tracking, and parallel/chain orchestration.

## Features

- **⚡️ Zero Bloat & Minimal Context**: Single lightweight tool schema (~150 tokens) replaces heavy multi-thousand-token multi-agent frameworks.
- **🎭 Built-in Golden Roles**:
  - `scout`: Fast read-only codebase reconnaissance (`read, grep, find`, `thinking: low`).
  - `researcher`: Autonomous web & technical documentation research (`read, grep, find, web_search, web_fetch`, `thinking: medium`).
  - `reviewer`: Disciplined adversarial code review and test validation (`read, grep, find, bash`, `thinking: high`).
- **🛡️ Runaway Guardrails**: Default 20-minute timeout and 50-turn limit prevent infinite loops or burning quota.
- **🔄 Pi-native Session Resumption**: Subagents assign clean project session IDs; paused or completed sessions can be resumed with `resume: "<sessionId>"`.
- **📊 Real-time TUI Card**: Differential progress card showing live execution duration, current thinking intent, active tool call traces with arguments, token usage, and cost tracking (`Alt+O` to expand/collapse).
- **⚙️ `/subagent` Slash Command**: Interactive TUI menu to configure global/project default models, thinking levels, and per-role overrides.

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
- Set default subagent model and thinking level (global or project scope).
- Configure specific roles (e.g. `researcher`, `reviewer`, `scout` or custom roles) with their preferred model, thinking level, and tools.
- Run `/subagent list` or `/subagent show` to view effective configurations and discovered agent templates.

## Tool Reference

### `subagent`

Execute tasks in isolated child agent sessions. Multiple tasks run concurrently by default, or sequentially as a pipeline when `chain: true`. Supports non-blocking background execution with `async: true`.

#### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `tasks` | `Array<TaskItem>` | **Yes** | List of tasks to execute. |
| `tasks[i].task` | `string` | **Yes** | The task instruction / prompt. |
| `tasks[i].agent` | `string` | No | Optional agent role (loads prompt/defaults from `.pi/agents/<name>.md`). |
| `tasks[i].model` | `string` | No | Optional model override (e.g. `gemini-3.7-flash`, `gpt-5:low`). |
| `tasks[i].thinking` | `string` | No | Optional thinking level (`off`, `low`, `medium`, `high`, `max`). |
| `tasks[i].tools` | `string[]` | No | Optional tool allowlist (e.g. `["read", "grep", "find"]`). |
| `tasks[i].cwd` | `string` | No | Optional working directory for the task. |
| `chain` | `boolean` | No | Set to `true` to pipe output from step N to step N+1. Default: `false` (concurrent). |
| `async` | `boolean` | No | Set to `true` to run in the background and notify upon completion. Default: `false`. |

#### Usage Examples

**1. Single task:**
```json
{
  "tasks": [{ "task": "Review packages/pi-subagent/src/index.ts for potential edge cases" }]
}
```

**2. Parallel fanout (multiple heterogeneous roles/models):**
```json
{
  "tasks": [
    { "agent": "frontend-dev", "task": "Check UI components" },
    { "agent": "backend-dev", "task": "Verify API contracts", "model": "gpt-5:high" }
  ]
}
```

**3. Sequential pipeline (`chain: true`):**
```json
{
  "chain": true,
  "tasks": [
    { "agent": "scout", "task": "Locate relevant test and config files" },
    { "agent": "reviewer", "task": "Perform adversarial review on the located files" }
  ]
}
```

**4. Background task (`async: true`):**
```json
{
  "async": true,
  "tasks": [{ "task": "Run end-to-end stress tests and summarize metrics" }]
}
```

## License

MIT
