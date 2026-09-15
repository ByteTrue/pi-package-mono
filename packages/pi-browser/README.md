# @bytetrue/pi-browser: agent-browser manager

Dedicated manager extension for [`agent-browser`](https://github.com/vercel-labs/agent-browser) in Pi. Focuses exclusively on operational management: browser selection, reusable login credentials (cookies + local storage), session monitoring and cleanup, and live observability.

It does not bundle or install a browser engine, register an agent tool, intercept shell commands, or control which CLI flags an agent may use. The agent works through the official agent-browser skill and CLI.

## What it provides

Run `/browser` to access:

- **Status** — see saved login states, current browser selection, dashboard state, agent-browser CLI and skill, effective user config, idle cleanup, and active sessions.
- **Logins** — first-class management of your saved login states (CRUD). Add new logins with an interactive browser window, update existing ones, rename, inspect domains/cookies, or delete them.
- **Dashboard** — control agent-browser's built-in observability dashboard (runs on port 4848). Start, stop, or open the live screencast & command activity feed in your browser.
- **Configure recommended defaults** — write clean, portable defaults to `~/.agent-browser/config.json`. Global `profile`, `session`, and `namespace` locks are cleared so multiple tasks can run concurrent browsers without lock contention.
- **Settings** — pick your preferred browser executable (Auto / Microsoft Edge / Google Chrome / Chrome for Testing / custom path), toggle visible or headless mode, and adjust idle cleanup timeout (5m / 10m / 30m / 1h).
- **Sessions** — inspect and close individual sessions, close all sessions, or run agent-browser's non-destructive stale pid/socket cleanup.
- **Setup commands** — display the commands you should run yourself. The extension never executes them.

## Install and set up

Install the extension:

```bash
pi install npm:@bytetrue/pi-browser
```

Open `/browser → Setup commands`, then run these commands yourself:

```bash
npm install -g agent-browser
agent-browser install
npx skills add vercel-labs/agent-browser -a pi -y -g
```

Return to `/browser` and choose **Configure recommended defaults**.

## Managing Logins

Choose `/browser → Logins` to manage your accounts:

- **Add new login**: Name it (e.g. `github`, `v2ex`, `work`). A visible browser opens for you to sign in. Click Yes to save cookies & local storage.
- **Update / Sign in**: Opens a browser with that saved login state loaded, allowing you to refresh sessions or sign in to additional sites.
- **Rename & Delete**: Rename login keys or permanently remove obsolete state files.
- **View details**: Inspect domains, cookie count, file size, and copy CLI/env usage snippets.

### Using saved logins in agent tasks

Pass the saved state file via CLI or environment variable:

```bash
# Using CLI flag
agent-browser --state ~/.pi/agent/pi-browser/auth/github.json open https://github.com

# Or via environment variable in current shell/Pi
export AGENT_BROWSER_STATE=~/.pi/agent/pi-browser/auth/github.json
```

Because login data is loaded from portable state files rather than a single locked browser directory, **multiple agent sessions can run in parallel concurrently without profile collisions (exit 21)**.

## Recommended config and cleanup

The recommended config uses:

```json
{
  "engine": "chrome",
  "headed": false,
  "idleTimeout": "10m",
  "screenshotDir": "<Pi agent dir>/pi-browser/artifacts"
}
```

By default, `executablePath` is not set (`Auto`), letting agent-browser discover installed browsers automatically. You can explicitly choose Microsoft Edge or Google Chrome under `/browser → Settings`.

The explicit idle timeout also applies to visible browsers. After 10 minutes without agent-browser activity, the daemon closes its owned Chrome process tree. If you do not want to wait, use `/browser → Sessions`.

On Windows, agent-browser owns Chrome through a Job Object, so terminating its daemon also terminates the Chrome processes it launched. **Clean stale process records** runs `agent-browser doctor --offline --quick` and removes orphaned session records.

## Configuration boundaries

pi-browser is an assistant, not a policy layer:

- It preserves agent-browser config keys it does not manage.
- It does not reject `--profile`, `--session`, `--state`, `--config`, or other CLI overrides.
- It does not intercept Bash or PowerShell.
- A project-level `agent-browser.json`, environment variables, or CLI flags can override the user defaults. Status points out a project override when one exists.
- Session cleanup operates on the `pi-browser` namespace.

## Files

| Purpose | Path |
| --- | --- |
| agent-browser user config | `AGENT_BROWSER_CONFIG`, or `~/.agent-browser/config.json` |
| saved login states (CRUD) | `<Pi agent dir>/pi-browser/auth/*.json` |
| screenshots and related output | `<Pi agent dir>/pi-browser/artifacts/` |
| official skill | `<Pi agent dir>/skills/agent-browser/` |
| legacy profile (unlocked) | `<Pi agent dir>/pi-browser/profiles/agent-browser/` |
