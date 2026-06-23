# @bytetrue/pi-subagents-plus

Small companion extension for `@gotgenes/pi-subagents`.

- Registers `/agents-plus`
- If `@gotgenes/pi-subagents` is missing, shows `pi install npm:@gotgenes/pi-subagents`
- Patches only existing agent Markdown frontmatter fields `model` and `thinking`
- For gotgenes built-ins, asks you to eject in `/agents` first instead of generating/overwriting prompts
- Backs up built-in overrides instead of deleting them
