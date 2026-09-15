# @bytetrue/pi-browser

Pi extension that configures a dedicated, persistent [`agent-browser`](https://github.com/vercel-labs/agent-browser) profile and helps clean up browser sessions left behind by agents.

It does not bundle or install a browser engine, register an agent tool, intercept shell commands, or control which CLI flags an agent may use. The agent works through the official agent-browser skill and CLI.

## What it provides

Run `/browser` to access:

- **Status** — see the persistent Profile, Chrome for Testing, agent-browser CLI and skill, effective user config, idle cleanup, and active managed sessions.
- **Configure recommended defaults** — write one persistent Profile, fixed default session/namespace, Chrome engine, screenshot directory, and a 10-minute idle timeout to `~/.agent-browser/config.json`.
- **Settings** — choose a visible or headless browser and change idle cleanup to 5 minutes, 10 minutes, 30 minutes, or 1 hour.
- **Sessions** — inspect and close sessions in the managed `pi-browser` namespace, or run agent-browser's non-destructive stale pid/socket cleanup.
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

To sign in once in a visible Chrome for Testing window:

```bash
agent-browser --headed open about:blank
```

Sign in to the sites you need, then close the managed browser:

```bash
agent-browser close
```

Future ordinary `agent-browser` commands reuse the same Profile, so cookies and local storage survive browser and Pi restarts.

## Persistent Profile and cleanup

The recommended config uses:

```json
{
  "engine": "chrome",
  "profile": "<Pi agent dir>/pi-browser/profiles/agent-browser",
  "session": "pi-browser",
  "namespace": "pi-browser",
  "headed": false,
  "idleTimeout": "10m",
  "screenshotDir": "<Pi agent dir>/pi-browser/artifacts"
}
```

If `agent-browser install` has downloaded Chrome for Testing, configuring again records its exact executable path. Otherwise pi-browser invents no path and Status explains that Chrome for Testing is still missing; a pre-existing `executablePath` is preserved, while a new config leaves normal browser discovery to agent-browser.

The explicit idle timeout also applies to visible browsers. After 10 minutes without agent-browser activity, the daemon closes its owned Chrome process tree and releases the Profile. If you do not want to wait, use `/browser → Sessions`.

On Windows, agent-browser owns Chrome through a Job Object, so terminating its daemon also terminates the Chrome processes it launched. **Clean stale process records** runs `agent-browser doctor --offline --quick`; it removes dead pid/socket records but does not install, reinstall, or update anything.

## Configuration boundaries

pi-browser is an assistant, not a policy layer:

- It preserves agent-browser config keys it does not manage.
- It does not reject `--profile`, `--session`, `--config`, or other CLI overrides.
- It does not intercept Bash or PowerShell.
- A project-level `agent-browser.json`, environment variables, or CLI flags can override the user defaults. Status points out a project override when one exists.
- Session cleanup explicitly loads the managed user config so `/browser` operates on the namespace it created.

## Files

| Purpose | Path |
| --- | --- |
| agent-browser user config | `AGENT_BROWSER_CONFIG`, or `~/.agent-browser/config.json` |
| persistent Pi Profile | `<Pi agent dir>/pi-browser/profiles/agent-browser/` |
| screenshots and related output | `<Pi agent dir>/pi-browser/artifacts/` |
| official skill | `<Pi agent dir>/skills/agent-browser/` |

The former Playwright profile at `<Pi agent dir>/pi-browser/profiles/default/` is not reused, migrated, or deleted automatically.
