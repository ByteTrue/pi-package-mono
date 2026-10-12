# pi-context-guard

Two context rules for Pi, registered as event hooks (no tools, no config):

1. **Compact at 400k, not at "window − reserve".** A model whose context window
   is larger than 400k tokens compacts once the context passes 400k. Models with
   a smaller window are not touched — Pi's default compaction policy applies there.
2. **The system prompt names the session file.** The session file keeps every
   message even after compaction replaces them in the model's view, so a detail
   a summary dropped stays reachable by searching the JSONL instead of being
   re-derived or guessed.

The pointer lives in the system prompt rather than the compaction instructions:
a summary is only as good as whatever produced it. Pi uses another extension's
summary verbatim when one handles `session_before_compact`, and custom
instructions are never passed to it. The system prompt is unaffected by who
compacts, or whether a compaction happened at all.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/ByteTrue/pi-package-mono/main/scripts/install-small-extension.sh | bash
```

Restart or reload Pi afterwards.
