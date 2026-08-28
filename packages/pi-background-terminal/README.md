<p align="center">
  <img src="./docs/banner.webp" alt="A command stream continuing through a suspended terminal plane" width="100%">
</p>

<h1 align="center">@bytetrue/pi-background-terminal</h1>

<p align="center">Run a shell command without making Pi wait for it.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@bytetrue/pi-background-terminal"><img src="https://img.shields.io/npm/v/@bytetrue/pi-background-terminal?style=flat-square" alt="npm version"></a>
</p>

Pi's built-in `bash` is the right tool for commands that finish during the current call. This extension adds a separate path for dev servers, watch mode, and long-running work—without overriding `bash`.

## Install

```bash
pi install npm:@bytetrue/pi-background-terminal
```

Restart or reload Pi, then ask naturally:

> Start the development server in the background.

The Agent starts the command, returns immediately, and receives a follow-up when the process exits on its own. Completions that pile up while the Agent is busy arrive as one batched follow-up, not one turn per task.

## Tools

| Tool | Required input | Result |
| --- | --- | --- |
| `background_run` | `command` | Starts a command and returns a task id plus output-file path |
| `background_status` | `id` | Returns status, exit code, line count, output path, and recent output |
| `background_kill` | `id` | Stops a running task |

All three schemas contain required parameters only. There are no timeout, working-directory, environment, list, or pagination arguments.

> [!NOTE]
> Full stdout and stderr stream to the output file returned by `background_run`. The Agent uses Pi's built-in `read` tool when it needs more than the recent preview.

## Manage tasks yourself

Run `/background` to open the human-facing task menu. It lists running tasks for the current session and lets you inspect their output or stop them with confirmation.

The footer shows `bg:N` while tasks are running.

## Lifecycle

A task ends when:

- the command exits;
- `background_kill` stops it; or
- the owning Pi session shuts down.

Natural completion wakes an idle Agent. Manual stops and session cleanup are silent. Tasks survive `/reload` inside the same session, but they do not survive Pi exiting.

Output is stored under `$TMPDIR/pi-background-terminal/` and removed at real session shutdown. Tasks are isolated by session id.

## Deliberate limits

- No PTY or interactive stdin
- No automatic timeout
- No custom `cwd` or environment input
- No daemon, tmux dependency, Web UI, or cross-session persistence
- No replacement for Pi's built-in `bash` or `read`

## Development

```bash
npm --workspace @bytetrue/pi-background-terminal test
npm --workspace @bytetrue/pi-background-terminal run typecheck
npm --workspace @bytetrue/pi-background-terminal pack --dry-run
```

Requires `@earendil-works/pi-coding-agent >=0.79.10`.
