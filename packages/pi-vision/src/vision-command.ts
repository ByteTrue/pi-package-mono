import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  COMMAND_NAME,
  listVisionModelRefs,
  projectSettingsPath,
  readConfiguredModelRef,
  writeConfiguredModelRef,
} from "./vision-model.js";

export async function runVisionCommand(ctx: ExtensionCommandContext): Promise<void> {
  if (!ctx.hasUI) return;

  const refs = listVisionModelRefs(ctx.modelRegistry.getAvailable());
  if (refs.length === 0) {
    ctx.ui.notify(
      "No vision-capable model in models.json. Add one first, then run /vision again.",
      "error",
    );
    return;
  }

  const current = readConfiguredModelRef(ctx.cwd);
  const picked = await ctx.ui.select(
    current
      ? `image_ask model — currently ${current}`
      : "image_ask model — not set yet",
    refs,
  );
  if (!picked) return;

  let path: string;
  try {
    path = writeConfiguredModelRef(picked);
  } catch (error) {
    ctx.ui.notify((error as Error).message, "error");
    return;
  }

  // Confirm the write actually takes effect: a project-level settings.json wins over the
  // global one this command writes, which would otherwise look like a silent no-op.
  const effective = readConfiguredModelRef(ctx.cwd);
  if (effective !== picked) {
    ctx.ui.notify(
      `Saved ${picked} to ${path}, but ${projectSettingsPath(ctx.cwd)} still overrides it with ${effective}.`,
      "warning",
    );
    return;
  }

  ctx.ui.notify(`image_ask will use ${picked} (saved to ${path})`, "info");
}

export function registerVisionCommand(pi: ExtensionAPI): void {
  pi.registerCommand(COMMAND_NAME, {
    description: "Choose which vision model image_ask uses",
    handler: async (_args, ctx) => runVisionCommand(ctx),
  });
}
