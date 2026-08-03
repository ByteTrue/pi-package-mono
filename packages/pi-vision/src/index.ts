import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerImageAskTool, TOOL_NAME } from "./image-ask.js";
import { registerVisionCommand } from "./vision-command.js";

/**
 * Substring of pi's own note in `core/tools/read.js` (`getNonVisionImageNote`), emitted when the
 * current model cannot accept images. Kept short so pi rewording the rest of the sentence
 * does not silently disable this fallback.
 */
export const NON_VISION_MARKER = "does not support images";

/**
 * pi's `read` always prefixes an image result with this (see `read.js`), whether or not the
 * image was actually droppable. Requiring both markers in the SAME text part is what stops a
 * false positive: NON_VISION_MARKER alone can appear in an ordinary text file that merely quotes
 * pi's error string (for example, this package's own issue doc) and must not be treated as a
 * real dropped image.
 */
export const IMAGE_READ_PREFIX = "Read image file [";

export function buildReadHint(path: unknown): string {
  const example = typeof path === "string" && path ? path : "path/to/image.png";
  return `\nTo actually see it, call ${TOOL_NAME} with paths: ["${example}"] and a specific question.`;
}

function syncImageAskTool(pi: ExtensionAPI, model: { input: readonly string[] } | undefined): void {
  if (!model) return;

  const active = new Set(pi.getActiveTools());
  if (model.input.includes("image")) active.delete(TOOL_NAME);
  else active.add(TOOL_NAME);
  pi.setActiveTools([...active]);
}

export default function registerVision(pi: ExtensionAPI): void {
  registerImageAskTool(pi);
  registerVisionCommand(pi);

  pi.on("session_start", (_event, ctx) => syncImageAskTool(pi, ctx.model));
  pi.on("model_select", (event) => syncImageAskTool(pi, event.model));

  // read() keeps working normally; it just tells a text-only model that the image was dropped.
  // That message is a dead end, so point it at image_ask instead. No-op for vision models,
  // because pi only emits the note when the current model cannot accept images.
  pi.on("tool_result", (event) => {
    if (event.toolName !== "read") return;
    const index = event.content.findIndex(
      (part) =>
        part.type === "text" &&
        part.text.startsWith(IMAGE_READ_PREFIX) &&
        part.text.includes(NON_VISION_MARKER),
    );
    if (index === -1) return;

    const part = event.content[index] as { type: "text"; text: string };
    const content = [...event.content];
    content[index] = { ...part, text: part.text + buildReadHint((event.input as { path?: unknown })?.path) };
    return { content };
  });
}
