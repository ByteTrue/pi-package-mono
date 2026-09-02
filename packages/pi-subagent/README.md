# @bytetrue/pi-subagent

Lightweight, high-performance Subagent runner for [Pi coding agent](https://pi.dev).

Spawns focused child agents in isolated sessions for research, code review, or sub-task delegation, complete with real-time TUI progress streaming, token & cost tracking, and parallel/chain orchestration.

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

Run a sub-agent in a dedicated, isolated child session.

#### Parameters

| Parameter | Type | Description |
|---|---|---|
| `task` | `string` | Task or research prompt for the subagent. |
| `agent` | `string` (optional) | Agent template name (loads prompt and default model/tools from `.pi/agents/<name>.md`). |
| `mode` | `single` \| `parallel` \| `chain` (optional) | Execution mode (default: `single`). |
| `tasks` | `string[]` (optional) | List of tasks for `parallel` or `chain` mode. |
| `tools` | `string[]` (optional) | Allowlist of tools for the child agent (e.g. `["read", "grep", "find"]`). |
| `model` | `string` (optional) | Model override (e.g. `gemini-3.7-flash` or `openai/gpt-4o:low`). |
| `thinking` | `string` (optional) | Thinking level override (`off`, `low`, `medium`, `high`, `max`). |
| `cwd` | `string` (optional) | Working directory for the subagent. |

## License

MIT
