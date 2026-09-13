<p align="center">
  <img src="./docs/banner.webp" alt="A command stream continuing through a suspended terminal plane" width="100%">
</p>

<h1 align="center">@bytetrue/pi-background-terminal</h1>

<p align="center">One bash tool: commands that finish come right back; commands that outlive your patience move to the background and notify you.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@bytetrue/pi-background-terminal"><img src="https://img.shields.io/npm/v/@bytetrue/pi-background-terminal?style=flat-square" alt="npm version"></a>
</p>

Pi's built-in `bash` blocks until the command finishes (or times out). This extension overrides `bash` with the same tool plus one optional parameter, `waitSeconds`:

- **omitted** — behaves exactly like the built-in tool, including a **default 10-minute timeout** this extension injects when the model does not pass one;
- **`waitSeconds: N`** — wait up to `N` seconds: if the command finishes, its output returns inline exactly like a normal call; if it is still running, it **automatically moves to the background**, the call returns a task id, and the Agent receives a follow-up when it exits—no polling;
- **`waitSeconds: 0`** — start the command in the background immediately (dev servers, watch mode).

`timeout` keeps its usual meaning and becomes a hard lifetime cap: if set, the task is killed when it expires, whether it was still being waited on or already in the background.

The Agent never has to predict how long a command will take. It only decides how long it is willing to block.

## Install

```bash
pi install npm:@bytetrue/pi-background-terminal
```

Restart or reload Pi, then ask naturally:

> Run the tests, but don't hang on them.

The Agent sets a `waitSeconds`, gets either the result or a background task id, and receives a follow-up when the command exits on its own. Completions that pile up while the Agent is busy arrive as one batched follow-up, not one turn per task.

## Tools

| Tool | Required input | Result |
| --- | --- | --- |
| `bash` (override) | `command` | Identical to the built-in tool, plus optional `waitSeconds` / `timeout` |
| `background_status` | `id` | Returns status, exit code, line count, output path, and recent output |
| `background_kill` | `id` | Stops a running task |

There are no working-directory, environment, list, or pagination arguments. The built-in `powershell` tool is deliberately not overridden (see below).

## How the override stays out of your way

- Calls without `waitSeconds` are pure delegation to Pi's own bash execution—including your configured `shellPath` and `shellCommandPrefix` settings (read through Pi's own `SettingsManager`, honoring project trust). The `waitSeconds` path applies the same settings and session environment (`PI_*` variables) that the built-in tool sets.
- Rendering falls back to Pi's built-in renderers; the tool looks and behaves like normal bash in the UI.
- Uninstalling (or a load failure) restores the built-in tool unchanged.
- `powershell` is not overridden: Pi only activates it when explicitly requested, and extension-registered tools are force-activated — overriding it would add a tool the default setup never shows. The default-timeout hook below still covers `powershell` by name.

Requires `@earendil-works/pi-coding-agent >= 0.80.5`.

> [!NOTE]
> Full stdout and stderr stream to the output file named in the result. The Agent uses Pi's built-in `read` tool when it needs more than the inline result.

## Default shell timeout

Calls that do not pass `waitSeconds` **and** do not pass their own `timeout` get `timeout: 600` injected via Pi's `tool_call` event, so a runaway foreground command (`find /`, a wedged build) cannot hang the agent for hours. Explicit timeouts are respected as-is; `waitSeconds` calls are skipped so a demoted dev server is never silently killed by the default.

## Manage tasks yourself

Run `/background` to open the human-facing task menu. It lists running tasks for the current session and lets you inspect their output or stop them with confirmation.

The footer shows `bg:N` while tasks are running.

## Lifecycle

A task ends when:

- the command exits;
- `background_kill` stops it;
- its hard `timeout` expires (status `timed_out`); or
- the owning Pi session shuts down.

Natural completion wakes an idle Agent. Manual stops and session cleanup are silent. Tasks survive `/reload` inside the same session, but they do not survive Pi exiting.

Output is stored under `$TMPDIR/pi-background-terminal/` and removed at real session shutdown. Tasks are isolated by session id. If Pi itself crashes (an uncaught exception or a dead terminal), no cleanup runs for that session — stale logs older than 24 hours are swept the next time the extension loads.

## Deliberate limits

- No PTY or interactive stdin
- No custom `cwd` or environment input
- No configurable default timeout value (600 seconds is fixed)
- No daemon, tmux dependency, Web UI, or cross-session persistence
- No output pagination in tool results—`read` handles large output

## Development

```bash
npm --workspace @bytetrue/pi-background-terminal test
npm --workspace @bytetrue/pi-background-terminal run typecheck
npm pack --workspace @bytetrue/pi-background-terminal --dry-run
```
