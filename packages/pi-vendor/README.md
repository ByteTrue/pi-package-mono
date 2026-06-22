# @bytetrue/pi-vendor

Pi extension for managing custom providers in `~/.pi/agent/models.json`.

Use `/vendor` to open a provider list, edit a provider draft, manage its models in a separate model-list flow, and save back to `models.json` only when you are ready.

- Provider edits stay in memory until save.
- Manual model IDs, local template matching, and OpenAI-compatible `/models` imports all use the same enrichment flow.
- The installed Pi official model catalog is checked first; local templates and safe defaults only fill gaps.
- Set `PI_CODING_AGENT_DIR` to redirect the agent dir in tests or backup workflows.
- After saving, open `/model` if you want pi to refresh the available model list.
