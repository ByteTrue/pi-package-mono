# Official Pi model catalog lookup

## Source inspected

- `/Users/byte/workspace/CFG/configs/ai-agent/pi/pi-official-model-config/SKILL.md`
- `/Users/byte/workspace/CFG/configs/ai-agent/pi/pi-official-model-config/scripts/lookup-official-model.mjs`
- Local installed catalog resolved by the helper: `/Users/byte/.local/share/mise/installs/node/24.15.0/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/models.generated.js`

## Confirmed behavior

- The installed local `models.generated.js` is the authoritative official Pi model catalog for this machine.
- The catalog exports `MODELS`, keyed by official provider, then model id.
- Lookup should search all official providers by model id, because the user's custom provider usually does not mirror Pi's official provider/API layout.
- A single model id can appear in multiple official providers/APIs. Example: `gpt-4o` appears under multiple official candidates.
- The existing helper's `makeMergeReady()` removes `provider`, `baseUrl`, `headers`, `apiKey`, and `authHeader`, then carries over the rest of the model object.
- The skill explicitly says not to maintain a fixed allowlist of model fields. Carry over new official metadata unless it is clearly routing/auth that must remain custom.

## Product implications

- Model enrichment should be official catalog first, local templates second, safe defaults last.
- Official lookup should use exact model id matching for enrichment. Fuzzy search is useful for human tools, but automatic enrichment should not guess metadata for a different id.
- If an exact model id has multiple official candidates, the extension should show candidates and let the user choose instead of auto-selecting by the current custom provider config.
- The user should preview the chosen config before saving, especially when the official candidate carries `api`, `compat`, or other behavior-affecting fields.
