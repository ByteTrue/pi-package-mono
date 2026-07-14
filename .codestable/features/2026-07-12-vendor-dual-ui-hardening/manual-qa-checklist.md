# vendor-dual-ui-hardening Manual QA (minimal)

Run once after install / local `pi install` of `@bytetrue/pi-vendor`. Do not paste secrets or capability URLs into tickets.

## TUI (`/vendor`)

| # | Step | Expected | Pass? |
|---|------|----------|-------|
| T1 | Interactive Pi → `/vendor` | Root: Add model / Add provider / Open full manager / Cancel; default first item | |
| T2 | Add model → existing provider → custom id → Save | Exactly one models.json write; registry refresh once | |
| T3 | Add model → Esc at each layer back to root | Zero writes | |
| T4 | Add provider shortest path → Save | One write; provider + first model present | |
| T5 | Add another model on new provider flow | Accumulates models; single final Save | |
| T6 | Non-TUI / pipe mode `/vendor` | Fail fast, no write | |
| T7 | Narrow terminal (~60 cols) root menu | Labels readable, no crash | |

## Web (`/vendor web`)

| # | Step | Expected | Pass? |
|---|------|----------|-------|
| W1 | Open full manager | Browser opens loopback page; or fallback URL shown in Pi only | |
| W2 | Edit baseUrl / Add setting optional field | Draft dirty; optional empty preserve until ×; common clear removes key | |
| W3 | apiKey with existing secret | Badge + replace/remove; no raw reveal in Raw JSON | |
| W4 | Raw JSON invalid syntax | Buffer preserved; Apply error; Discard restores | |
| W5 | Rename provider with secrets under source | Blocked until secrets removed/re-entered | |
| W6 | Models: add / edit / delete with confirm | Draft-only until Save; delete shows counts when secrets present | |
| W7 | Import /models → select ≤100 → replace confirm | Shows model + known-secret counts; Cancel aborts enrich | |
| W8 | Save | One PUT; page saved state; Pi session settles | |
| W9 | Cancel / Pi Esc | Zero write; server closed | |
| W10 | Keyboard-only tab through list, fields, dialogs | Focus visible; destructive dialog first focus Cancel | |
| W11 | Narrow viewport (~360px) | Save/Cancel not clipped off-screen | |
| W12 | Close browser tab without Cancel | Return to Pi, press Esc to settle | |

## Automated already green

```bash
npm --workspace @bytetrue/pi-vendor run build:web
npm --workspace @bytetrue/pi-vendor test   # 285
npm test                                   # + pi-web-search 88
node packages/pi-vendor/scripts/pack-smoke.mjs
```

## Notes

- Record pass/fail only; no screenshots of secrets.
- If any core path fails, open an issue against the owning feature (not “fix in hardening”).
