import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  COMMAND_NAME,
  listVisionModelRefs,
  projectSettingsPath,
  readAutoAnalyzeAttachments,
  readConfiguredModelRef,
  resolveVisionModel,
  writeAutoAnalyzeAttachments,
  writeConfiguredModelRef,
} from "./vision-model.js";

export async function runVisionCommand(ctx: ExtensionCommandContext, args = ""): Promise<void> {
  if (!ctx.hasUI) return;
  const projectTrusted = ctx.isProjectTrusted();
  const command = args.trim().toLowerCase();
  const auto = /^auto\s+(on|off)$/.exec(command);
  if (command && !auto) {
    ctx.ui.notify(`Usage: /${COMMAND_NAME} or /${COMMAND_NAME} auto on|off`, "error");
    return;
  }

  if (auto) {
    const enabled = auto[1] === "on";
    if (enabled) {
      const resolved = await resolveVisionModel(ctx);
      if (!resolved.ok) {
        ctx.ui.notify(resolved.error, "error");
        return;
      }
    }

    let path: string;
    try {
      path = writeAutoAnalyzeAttachments(enabled);
    } catch (error) {
      ctx.ui.notify((error as Error).message, "error");
      return;
    }

    if (readAutoAnalyzeAttachments(ctx.cwd, projectTrusted) !== enabled) {
      ctx.ui.notify(
        `Saved auto mode to ${path}, but ${projectSettingsPath(ctx.cwd)} still overrides it.`,
        "warning",
      );
      return;
    }

    ctx.ui.notify(
      `Automatic attached-image analysis ${enabled ? "enabled" : "disabled"} (saved to ${path}).`,
      "info",
    );
    return;
  }

  const refs = listVisionModelRefs(ctx.modelRegistry.getAvailable());
  if (refs.length === 0) {
    ctx.ui.notify(
      "No vision-capable model in models.json. Add one first, then run /vision again.",
      "error",
    );
    return;
  }

  const current = readConfiguredModelRef(ctx.cwd, projectTrusted);
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
  const effective = readConfiguredModelRef(ctx.cwd, projectTrusted);
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
    description: "Choose the vision model or configure automatic attached-image analysis",
    handler: async (args, ctx) => runVisionCommand(ctx, args),
  });
}
