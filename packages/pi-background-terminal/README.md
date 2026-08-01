# @bytetrue/pi-background-terminal

Three independent tools to run a shell command in the background, check on it, and stop it — without touching or overriding Pi's built-in `bash`.

- `background_run` starts a command and returns immediately with a task id; the command keeps running.
- `background_status` lists all background tasks, or reports one task's status/exit code/output file.
- `background_kill` stops a running one.
- When a task finishes (or times out), a follow-up message wakes the agent automatically — no polling required.
- Output streams to a file as it's produced; use the built-in `read` tool on that path for the full output instead of getting it dumped inline, which keeps a long command's output from flooding context.
- `timeoutSeconds` is required on every `background_run` call, so a hung command can never run forever.
- Task lifetime matches the current Pi session; a real session end (not `/reload`) stops any still-running tasks and deletes their output files. Tasks survive `/reload`, which re-evaluates the extension module.

## Install

```bash
pi install npm:@bytetrue/pi-background-terminal
```

## Tools

### `background_run`

- `command` (required)
- `timeoutSeconds` (required) — the command is auto-terminated if it runs longer than this

Returns a task id and the output file path immediately. Use this only for a command that must outlive the tool call (a dev server, a watch mode, a long build/test); for anything that finishes on its own, use `bash`.

### `background_status`

- `id` (optional) — omit to list all background tasks; pass it for one task's detail

Detail view includes status (`running`/`exited`/`killed`/`timed_out`/`failed`), exit code, output file path, line count, and a short recent-output preview. Never returns the full output inline — use `read` on the file path for that.

### `background_kill`

- `id` (required)

Stops a running task before its `timeoutSeconds` elapses on its own.

## Verification

```bash
npm --workspace @bytetrue/pi-background-terminal run typecheck
npm --workspace @bytetrue/pi-background-terminal test
```
