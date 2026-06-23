# @bytetrue/pi-subagents-plus

Small companion extension for `@gotgenes/pi-subagents`.

- Registers `/agents-plus`
- Shows `pi install npm:@gotgenes/pi-subagents` if gotgenes `/agents` is missing
- Main flow: `Manage agents` → pick an agent with current model/thinking shown → configure model and thinking from one details screen
- Patches only existing agent Markdown frontmatter fields `model` and `thinking`
- For gotgenes built-ins, asks you to eject in `/agents` first instead of generating/overwriting prompts
- Backs up built-in overrides instead of deleting them
