# @bytetrue/pi-browser

Pi extension that gets browser automation ready, using the official tools instead of a bundled engine.

One command, `/browser`:

- **Target: X** — shows and switches which browser *and profile* playwright-cli drives. Picking a target only rewrites the CLI config: it never copies or deletes browser data.
- **Data** — **Import** copies cookies and storage from your daily Edge/Chrome profile into a profile this package owns (the *copy*); **Re-import** refreshes that snapshot; **Manual sign-in** opens the copy in a visible window so you can log in to sites that cannot be imported (Google and friends), and closes it for you when you say you are done; **Clear imported data** removes the copy. Importing always lands in the copy and never changes your current target.
- **Settings** — switch between headless and headed sessions.
- **Status** — bordered read-only panel: the current target and what kind it is, lock holder, copy profile, last import, CLI config, CLI version, skill, artifacts.
- **Sessions** — see and close browser sessions the CLI left running (force kill reaches other workspaces).
- **Setup** — install or update the official [`@playwright/cli`](https://github.com/microsoft/playwright-cli) and its skill (`playwright-cli install --skills=agents -g`, which Pi reads from `~/.agents/skills`).

The agent then works through the official skill and CLI; this package registers no agent tools and no skills of its own.

## The copy profile is the supported target

By default the target is a profile this package owns: a copy of your daily browser's login data. Playwright launches the source browser with `--user-data-dir=<agent dir>/pi-browser/profiles/default`, and **the browser decrypts the imported cookies itself** through the normal OS keychain — we never implement cookie decryption. No extension, no tab groups, no dedicated-profile re-login.

A target is `(channel, userDataDir, profileDirectory?)`; a non-`Default` profile is selected with `--profile-directory=<X>`.

You *can* point the target at a real daily profile instead — that removes the snapshot problem entirely (your logins are just there, including Google). It is offered but deliberately gated, because in testing it is the worse experience:

- It asks for **informed consent every time**: the agent then acts **as you**, in your real profile — writing your history and cookies, and able to read and post on every site you are signed in to. Your browser may **sync those changes to your other devices**.
- Chromium allows **one process per profile**, so it only works while that browser is fully closed. If it is running, this package refuses and names the holder; it will never close your browser for you.
- On a large real profile (2.7 GB `Default`), launching it from playwright-cli **timed out at 180s — and still rewrote 111 files of the profile before failing**. The same profile copied to a scratch dir launched instantly with working logins. So the real-profile path is experimental, and nothing in this package ever launches it on its own: the import smoke test and the sign-in window use their own scratch configs that point at the copy.

## Config keys that make or break this

| Key | Why |
| --- | --- |
| `browser.browserName: "chromium"` | without it, `launchOptions.channel` is ignored and Playwright launches Chrome |
| `browser.launchOptions.channel` | must match the profile's browser family (Edge → `msedge`) so the OS keychain entry matches |
| `browser.launchOptions.ignoreDefaultArgs: ["--use-mock-keychain"]` | Playwright's default mock keychain makes imported cookies fail to decrypt and get dropped silently |

The third is load-bearing for **Playwright launching a browser directly** (non-persistent). It is a no-op on the `playwright-cli` persistent-profile path we actually use — that path does not pass the flag at all — and we keep writing it in case upstream changes.

## What to expect

- Cookies are copied while the source browser may be running; the copy is verified and retried, and the target is only swapped in once complete. **Your own browser is never an import destination** — importing replaces files wholesale, so writing into a daily profile would wipe your own logins, and this package refuses it.
- Login state is a **snapshot**: sites that bind sessions to their source (for example Google) may need a fresh sign-in, and logins expire — run **Re-import** to refresh.
- A **re-import overwrites the whole copy**, including anything you signed in to by hand: cookies and storage are copied file-by-file, so there is no merge. If you used **Manual sign-in**, redo those sign-ins after each re-import.
- **Manual sign-in** blocks until you press Enter at its prompt, then closes the window itself. Closing the browser window by hand is not enough — that leaves the browser process and its profile lock alive, which would block the next import or agent session. If you interrupt Pi mid-flow, close the leftover session from **Sessions**.
- One browser at a time: a live session holds a profile, so a second `open` fails until the first is closed. `/browser → Sessions` exists for exactly this.

## Install

```bash
pi install npm:@bytetrue/pi-browser
```

Files it manages: `~/.playwright/cli.config.json` (backed up before each change), `<agent dir>/pi-browser/profiles/default/` (0700), `state.json` (0600), `smoke.config.json` / `sign-in.config.json` (scratch configs so nothing ever launches your current target behind your back), and `artifacts/` for CLI output.
