# @bytetrue/pi-background-terminal

OpenCode-style background terminal sessions for Pi.

- Real PTY-backed sessions via `@lydell/node-pty`
- Managed tools: `pty_spawn`, `pty_list`, `pty_read`, `pty_write`, `pty_kill`
- Exit notifications back into the Pi session via `notifyOnExit`
- Web monitor commands: `/pty-open-background-spy`, `/pty-show-server-url`
- Session lifetime matches the current Pi session; everything is cleaned up on `session_shutdown`

## Install

```bash
pi install npm:@bytetrue/pi-background-terminal
```

## Tools

### `pty_spawn`
Start a background PTY session.

Key fields:
- `command`
- `args`
- `description`
- `workdir`
- `env`
- `title`
- `notifyOnExit`
- `timeoutSeconds`

### `pty_list`
List PTY sessions for the current Pi session.

### `pty_read`
Read buffered output, with optional regex filtering.

### `pty_write`
Send stdin to a session. Send `"\x03"` for Ctrl-C.

### `pty_kill`
Stop or clean up a session.

## Web monitor

- `/pty-open-background-spy` — open the local PTY monitor in your browser
- `/pty-show-server-url` — show the monitor URL

The web monitor is loopback-only and authenticated for API / WebSocket access with a per-session token.

## Verification

```bash
npm --workspace @bytetrue/pi-background-terminal run typecheck
npm --workspace @bytetrue/pi-background-terminal test
```

## Notes

Inspired by the OpenCode `opencode-pty` plugin model and semantics.
