# @bytetrue/pi-background-terminal

Three independent tools to run a shell command in the background, check on it, and stop it — without touching or overriding Pi's built-in `bash` — plus a `/background` menu for users.

- `background_run` starts a command and returns immediately with a task id; the command keeps running.
- `background_status` lists all background tasks, or reports one task's status/exit code/output file.
- `background_kill` stops a running one.
- When a task finishes normally or times out, a follow-up message wakes the agent automatically — manually stopped tasks are silent.
- Output streams to a file as it's produced; use the built-in `read` tool on that path for the full output instead of getting it dumped inline, which keeps a long command's output from flooding context.
- `timeoutSeconds` is optional. Omit it for a long-lived development service; provide it when the command should be auto-terminated.
- Task lifetime matches the current Pi session; a real session end (not `/reload`) waits for and stops all owned processes, then deletes their output files. Tasks survive `/reload`, which re-evaluates the extension module.
## Install

```bash
pi install npm:@bytetrue/pi-background-terminal
```

## User command

### `/background`

Opens a menu for the current session's running background commands. Finished, killed, timed-out, and failed tasks stay available through `background_status`, but do not clutter this management menu. Select a command to open its output in the native editor, stop it, or return to the list. The menu owns the selection flow; users do not need to remember `list`/`kill` syntax or copy task ids.

## Tools

### `background_run`

- `command` (required)
- `timeoutSeconds` (optional) — auto-terminate the command after this many seconds; omit it for no timeout

Returns a task id and the output file path immediately. Use this only for a command that must outlive the tool call (a dev server, a watch mode, a long build/test); for anything that finishes on its own, use `bash`.

### `background_status`

- `id` (optional) — omit to list all background tasks; pass it for one task's detail

Detail view includes status (`running`/`exited`/`killed`/`timed_out`/`failed`), exit code, output file path, line count, and a short recent-output preview. Never returns the full output inline — use `read` on the file path for that.

### `background_kill`

- `id` (required)

Stops a running task before its optional timeout elapses. A manually stopped task does not generate a completion follow-up.

## Verification

```bash
npm --workspace @bytetrue/pi-background-terminal run typecheck
npm --workspace @bytetrue/pi-background-terminal test
```
