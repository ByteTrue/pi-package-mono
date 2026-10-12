# pi-codemode-only

Makes Pi's `codemode.mode: "only"` setting mean what it says. No-op unless
only-mode is on (and a no-op on Pi cores where codemode does not exist).

Pi ≥ 1.1.0 stops *enforcing* only-mode: direct tools stay active so codemode
scripts can call them, and a model that ignores the prompt can still call
`bash`/`read`/... directly — the call runs. This extension restores the
contract with two event hooks (no tools, no config):

- **tool_call** — blocks top-level calls to anything but `codemode`, with a
  reason that names the codemode form (`await tools.<name>({ ... })`). Nested
  calls made by scripts carry `parentToolCallId` and pass through.
- **before_agent_start** — rewrites the two prompt spots that still point at
  direct tools: the `<tools>` tail line ("In addition to the tools above, ...")
  becomes "everything else runs from inside a codemode script", and the
  `<skills>` line points skill-file loading at codemode. `<rules>` is left
  alone on purpose.

The prompt rewrites match Pi's shipped wording; if a core release rewords
those lines the rewrite silently degrades (the block still enforces only-mode).
`TOOLS_TAIL` / `SKILLS_SENTENCE` are the two constants to re-align.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/ByteTrue/pi-package-mono/main/scripts/install-small-extension.sh | bash
```

Restart or reload Pi afterwards. Requires `codemode.mode: "only"` in Pi settings.
