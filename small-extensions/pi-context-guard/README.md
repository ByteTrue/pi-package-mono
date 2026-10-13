# pi-context-guard

Three context features for Pi:

1. **`/context` slash command**: surgically configures the `contextWindow` parameter
   for user models in `models.json`.
   - Supports direct arguments (e.g. `/context 300k`, `/context 400000`) or interactive input prompts.
   - Interactive multi-select menu with capacity filtering: only lists models whose true capacity is larger than the requested threshold, automatically skipping and protecting smaller models (e.g. 272k <= 400k) from accidental misconfiguration. One-click select-all safely selects only eligible large models.
   - **Surgical text replacement**: only updates or inserts `contextWindow` for chosen models without reformatting the file, keeping comments, custom indentation, field orders, and untouched models completely intact.
   - Prompts the user to run `/reload` to apply changes immediately.
2. **Restore original parameters**:
   - Run `/context restore` (or choose "2. Restore original parameters" from the `/context` root menu).
   - Preserves original `contextWindow` values before first modification in private config (`<agent-dir>/pi-pkg-cfg/pi-context-guard/originals.json`).
   - Restores numerical values exactly, or cleanly deletes the `contextWindow` line if the model originally had it unset.
3. **Session-file pointer in system prompt**: names the session JSONL file in the
   system prompt (`sections.session_file`), so details dropped by compaction summaries
   remain reachable and searchable by the agent.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/ByteTrue/pi-package-mono/main/scripts/install-small-extension.sh | bash
```

Restart or reload Pi afterwards.
