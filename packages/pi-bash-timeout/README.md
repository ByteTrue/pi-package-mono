<h1 align="center">@bytetrue/pi-bash-timeout</h1>

<p align="center">Optional 300s default-and-cap for Pi's built-in <code>bash</code> and <code>powershell</code> tools.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@bytetrue/pi-bash-timeout"><img src="https://img.shields.io/npm/v/@bytetrue/pi-bash-timeout?style=flat-square" alt="npm version"></a>
</p>

Pi's built-in `bash` runs with no timeout unless the model passes one, so a single runaway foreground command (`find /`) can wedge the agent for hours. This package adds two event hooks and nothing else:

- **Default** — a `tool_call` hook injects `timeout: 300` when a `bash`/`powershell` call passes none (a passed `0` counts as absent — Node convention reads it as "infinite", which is exactly what this package prevents).
- **Cap** — an explicit timeout above 300s is clamped down to it. An agent turn blocked on one foreground command wedges everything: user, subagents, all of it. Commands that legitimately need longer (builds, test suites, dev servers) have a real home: `background_run` from [`@bytetrue/pi-background-terminal`](../pi-background-terminal) with a large timeout, whose exit arrives as a new message instead of blocking the turn.
- **Steering** — when a shell command dies on the 300s cap, a `tool_result` hook appends one steering block to the raw timeout error: long commands belong in `background_run`; a hung command needs a cause, not a retry.

No tool is registered, overridden, or executed here — only a missing parameter gets a default value and an oversized one gets clamped. `background_run` (when installed) resolves its own, longer lifetime default inside its execute.

## Install

```bash
pi install npm:@bytetrue/pi-bash-timeout
```

Restart or reload Pi. There is nothing to configure and nothing to invoke — the cap is simply there.

> [!TIP]
> **Don't want the cap? Don't install this package.** It is standalone by design (split out of `@bytetrue/pi-background-terminal` in its 0.12.0): [`@bytetrue/pi-background-terminal`](../pi-background-terminal) no longer contains any foreground-timeout hook source, and this package no longer contains any background tools. Architectures whose setup checks statically scan installed source and reject foreground-timeout hooks can install `pi-background-terminal` alone.

## Uninstall

```bash
pi uninstall npm:@bytetrue/pi-bash-timeout
```

The built-in `bash`/`powershell` tools return to their exact built-in behavior — no default timeout, no cap, no steering. The package registers no tools and no commands, so there is nothing else to clean up.

## Tools

None. The package registers no tools and no commands — `bash` and `powershell` stay Pi's own, untouched in schema and execution; only their `timeout` input is defaulted and capped.

## Deliberate limits

- No configurable cap value (300s is fixed; the escape hatch is `background_run`'s longer lifetime)
- No per-tool or per-project opt-out, and no runtime switch — an install either caps or it does not (that is the point: a setup check scanning the installed source must find either the whole hook or none of it)
- No override of any built-in tool; no tool registration at all
- `pi-background-terminal`-free by design: install either package alone, or both — they never depend on each other

## Development

```bash
npm --workspace @bytetrue/pi-bash-timeout test
npm --workspace @bytetrue/pi-bash-timeout run typecheck
npm pack --workspace @bytetrue/pi-bash-timeout --dry-run
```
