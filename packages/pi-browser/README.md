# @bytetrue/pi-browser

Pi extension that gets browser automation ready, using the official tools instead of a bundled engine.

One command, `/browser`:

- **Setup** — install or update the official [`@playwright/cli`](https://github.com/microsoft/playwright-cli) and its skill (`playwright-cli install --skills=agents -g`, which Pi reads from `~/.agents/skills`).
- **Import login data** — copy cookies and storage from your daily Edge/Chrome profile into a profile this package owns, then point the global `~/.playwright/cli.config.json` at it. **Re-import** refreshes that snapshot; **Clear imported data** removes it.
- **Status** — profile, config, CLI version, skill, and the last import.
- **Sessions** — see and close browser sessions the CLI left running (force kill reaches other workspaces).

The agent then works through the official skill and CLI; this package registers no agent tools and no skills of its own.

## How the import works

The managed profile is a copy, not a live bridge. Playwright launches Edge with `--user-data-dir=<agent dir>/pi-browser/profiles/default` and without `--use-mock-keychain`, so **the browser itself decrypts the imported cookies** through the normal OS keychain. No extension, no tab groups, no dedicated-profile re-login.

Three config keys make or break this; the package writes and repairs them:

| Key | Why |
| --- | --- |
| `browser.browserName: "chromium"` | without it, `launchOptions.channel` is ignored and Playwright launches Chrome |
| `browser.launchOptions.channel` | must match the import source (Edge → `msedge`) so the OS keychain entry matches |
| `browser.launchOptions.ignoreDefaultArgs: ["--use-mock-keychain"]` | Playwright's default mock keychain makes every imported cookie fail to decrypt and get dropped silently |

## What to expect

- Cookies are copied while the source browser may be running; the copy is verified and retried, and the target profile is only swapped in once complete. Your own browser windows are never touched.
- Login state is a **snapshot**: sites that bind sessions to their source (for example Google) may need a fresh sign-in, and logins expire — run **Re-import** to refresh.
- One browser at a time: a live session holds the managed profile, so a second `open` fails until the first is closed. `/browser → Sessions` exists for exactly this.

## Install

```bash
pi install npm:@bytetrue/pi-browser
```

Files it manages: `~/.playwright/cli.config.json` (backed up before each change), `<agent dir>/pi-browser/profiles/default/` (0700), `state.json` (0600), and `artifacts/` for CLI output.
