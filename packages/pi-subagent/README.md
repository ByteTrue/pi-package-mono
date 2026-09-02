# @bytetrue/pi-subagent

Lightweight, high-performance Subagent runner for [Pi coding agent](https://pi.dev).

Spawns focused child agents in isolated sessions for delegating tasks, background work, code reviews, or investigations, complete with real-time TUI progress streaming, token & cost tracking, and parallel/chain orchestration.

## Features

- **⚙️ `/subagent` Slash Command**: Interactive TUI menu to configure global/project default models, thinking levels, and per-role overrides (e.g. `researcher`, `reviewer`).
- **⚡️ Zero Bloat & Minimal Context**: Single lightweight tool schema (~150 tokens) replaces heavy multi-thousand-token multi-agent frameworks.
- **📊 Real-time TUI Card**: Differential progress card showing live execution duration, current thinking intent, active tool call traces with arguments, token usage, and cost tracking.
- **⌨️ Interactive Expansion**: Press `Alt+O` to toggle detailed execution traces on the active subagent card.
- **🔄 Flexible Execution Modes**:
  - `single`: Focus on one task/investigation.
  - `parallel`: Run multiple prompts concurrently and aggregate results.
  - `chain`: Run multi-step pipeline passing previous output forward.
- **🎯 Precision Control**:
  - `tools`: Restrict child agent capabilities (e.g. `["read", "grep", "find", "web_search"]` for safe read-only research).
  - `model`: Model override per sub-agent run (e.g. use a faster or specialized reasoning model).
  - `thinking`: Thinking level override (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`).
- **📁 Agent Definitions**: Automatically discovers agent definitions in `.pi/agents/<name>.md` or `~/.pi/agent/agents/<name>.md`.

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
