# @bytetrue/pi-background-terminal

Three independent tools that use Pi's local bash execution backend to run a shell command in the background, check on it, and stop it — without overriding the built-in `bash` tool — plus a `/background` menu for users.

- `background_run` starts a command and returns immediately with a task id; the command keeps running.
- `background_status` reports one task's status, exit code, and output file.
- `background_kill` stops a running one.
- When a task finishes normally, a follow-up message wakes the agent automatically; manually stopped tasks are silent.
- Output streams to a file as it's produced; use the built-in `read` tool on that path for the full output instead of getting it dumped inline, which keeps a long command's output from flooding context.
- Task lifetime matches the current Pi session; a real session end (not `/reload`) waits for and stops all owned processes, then deletes their output files. Tasks survive `/reload`, which re-evaluates the extension module.
- The footer shows `bg:N` while this session has running tasks; it disappears at zero.
## Install

```bash
pi install npm:@bytetrue/pi-background-terminal
```

## User command

### `/background`

Opens a menu for the current session's running background commands. Select a command to open its output in the native editor, stop it, or return to the list. The menu owns the selection flow; users do not need to remember task ids.

## Tools

### `background_run`

- `command` (required)

Returns a task id and the output file path immediately. Use this only for a command that must outlive the tool call (a dev server, a watch mode, a long build/test); for anything that finishes on its own, use `bash`.

### `background_status`

- `id` (required) — task id returned by `background_run`

Returns status (`running`/`exited`/`killed`/`failed`), exit code, output file path, line count, and a short recent-output preview. Never returns the full output inline — use `read` on the file path for that.

### `background_kill`

- `id` (required)

Stops a running task. A manually stopped task does not generate a completion follow-up.

## Verification

```bash
npm --workspace @bytetrue/pi-background-terminal run typecheck
npm --workspace @bytetrue/pi-background-terminal test
```
