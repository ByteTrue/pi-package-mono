<p align="center">
  <img src="./docs/banner.webp" alt="A command stream continuing through a suspended terminal plane" width="100%">
</p>

<h1 align="center">@bytetrue/pi-background-terminal</h1>

<p align="center">Pure background execution: <code>background_run</code> starts a command, returns a task id immediately, and notifies you when it exits.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@bytetrue/pi-background-terminal"><img src="https://img.shields.io/npm/v/@bytetrue/pi-background-terminal?style=flat-square" alt="npm version"></a>
</p>

Pi's built-in `bash` is the foreground executor — and this package never touches it. It adds one standalone tool for the other half of the decision:

- **Need the command's output to continue?** Use `bash` — it blocks and returns the result.
- **Should it run hands-off (builds, test suites, dev servers, watch mode)?** Use `background_run` — it returns a task id immediately, and the Agent keeps working or ends its turn, and the command's exit arrives as a new message (exit code + last output line) that starts the next turn. That notification is how the Agent waits.

`background_run(command, timeout?)`:

- **`timeout` defaults to 600 seconds** — a hard lifetime cap so nothing lingers forever. Pass a larger value (e.g. `86400`) for dev servers and watch modes.
- Full stdout/stderr stream live to an output file (path in the result); the Agent reads it with Pi's built-in `read` only when needed.
- In TUI/RPC sessions the exit notification fires normally. In `pi -p` the process exits with the turn, so a task started there dies before its exit can be reported — hands-off backgrounding belongs in interactive sessions (subagent children are killed by their own `session_shutdown`).

## Install

```bash
pi install npm:@bytetrue/pi-background-terminal
```

Restart or reload Pi, then ask naturally:

> Start the test suite running hands-off — get back to me when it finishes.

The Agent calls `background_run`, keeps working or waits, and reports the outcome when the exit notification arrives. Completions that pile up while the Agent is busy arrive as one batched follow-up, not one turn per task.

## Tools

| Tool | Required input | Result |
| --- | --- | --- |
| `background_run` | `command` | Task id + output file path, immediately; exit reported via follow-up; optional `timeout` (default 600s) |
| `background_status` | `id` | Status, exit code, line count, output path, and recent output |
| `background_kill` | `id` | Stops a running task |

No built-in tool is overridden, shadowed, or registered under a built-in name.

## Staying out of the built-ins' way

- `bash` (and `powershell`) keep their exact built-in behavior; the only touch is a `tool_call` hook injecting `timeout: 600` when a call passes none — a safety net for runaway foreground commands, not a coupling. Explicit timeouts are respected.
- The `background_run` path applies your `shellPath` / `shellCommandPrefix` settings (read through Pi's own `SettingsManager`, honoring project trust) and the same session environment the built-in tools set (`PI_*` variables plus the agent bin dir on `PATH`).
- Uninstalling removes exactly the three tools above; the built-ins were never touched.

Requires `@earendil-works/pi-coding-agent >= 0.80.5`.

## Lifecycle

A task ends when:

- the command exits (the agent is woken with the outcome);
- `background_kill` stops it (silent);
- its hard `timeout` expires (status `timed_out`, the agent is woken); or
- the owning Pi session shuts down — or the Pi process dies by any path (signal, crash): tasks spawn through Pi's own shell backend and are killed with it (verified against SIGTERM; only a command that daemonizes itself escapes, same as built-in bash).

Manual stops and session cleanup are silent. Tasks survive `/reload` inside the same session, but they do not survive Pi exiting.

Output is stored under `$TMPDIR/pi-background-terminal/` and removed at real session shutdown. Output files cap at 50 MiB: beyond that the file stops growing and a marker records what was dropped (the task itself keeps running). Tasks are isolated by session id. If Pi itself crashes, stale logs older than 24 hours are swept the next time the extension loads.

## Deliberate limits

- Pure background: no foreground wait, no inline output (that is `bash`'s job)
- No override of any built-in tool (the 600s input default is the only touch)
- No PTY or interactive stdin
- No custom `cwd` or environment input
- No configurable defaults (600s lifetime / 50 MiB cap are fixed)
- No daemon, tmux dependency, Web UI, or cross-session persistence
- No output pagination in tool results—`read` handles large output

## Development

```bash
npm --workspace @bytetrue/pi-background-terminal test
npm --workspace @bytetrue/pi-background-terminal run typecheck
npm pack --workspace @bytetrue/pi-background-terminal --dry-run
```
