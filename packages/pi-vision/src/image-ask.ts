import type { AssistantMessage, ImageContent } from "@earendil-works/pi-ai";
// ponytail: "@earendil-works/pi-ai/compat" is documented as temporary ("deleted with the
// coding-agent ModelManager migration"), but it is what pi's own examples/extensions/summarize.ts
// uses and the only entry exposing complete(). Swap for the successor API when it lands.
import { complete } from "@earendil-works/pi-ai/compat";
import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readImageFile } from "./image-file.js";
import { resolveVisionModel } from "./vision-model.js";

export const TOOL_NAME = "image_ask";

export interface ImageAskDetails {
  model: string;
  imageCount: number;
}

/** Injected so tests never touch the network. */
export type CompleteFn = typeof complete;

const parameters = Type.Object({
  paths: Type.Array(Type.String(), {
    description:
      "Local image file paths (absolute, or relative to cwd). Pass every image relevant to the question in one call so they can be compared.",
  }),
  question: Type.String({
    description:
      "What you need to know about the image(s). Be specific — you get one text answer back, not the image itself.",
  }),
});

/**
 * Never echo an upstream message that contains the API key. Some gateways mirror
 * request headers back in 401 bodies.
 */
function safeUpstreamMessage(raw: string | undefined, apiKey: string | undefined): string {
  if (!raw) return "no detail returned";
  if (apiKey && apiKey.length >= 8 && raw.includes(apiKey)) {
    return "detail withheld: the upstream response echoed the API key";
  }
  return raw.length > 500 ? `${raw.slice(0, 500)}…` : raw;
}

function answerText(message: AssistantMessage): string {
  return message.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n")
    .trim();
}

export async function runImageAsk(
  params: { paths: string[]; question: string },
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
  completeFn: CompleteFn,
): Promise<AgentToolResult<ImageAskDetails>> {
  if (params.paths.length === 0) throw new Error("No image paths given.");
  if (!params.question.trim()) throw new Error("No question given.");

  if (ctx.model?.input.includes("image")) {
    throw new Error("image_ask is unavailable because the current model already supports images.");
  }
  const resolved = await resolveVisionModel(ctx);
  if (!resolved.ok) throw new Error(resolved.error);

  const images: ImageContent[] = [];
  for (const path of params.paths) {
    images.push(await readImageFile(path, ctx.cwd));
  }

  const modelRef = `${resolved.model.provider}/${resolved.model.id}`;
  let response: AssistantMessage;
  try {
    response = await completeFn(
      resolved.model,
      {
        messages: [
          {
            role: "user",
            content: [...images, { type: "text", text: params.question }],
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey: resolved.auth.apiKey,
        headers: resolved.auth.headers,
        env: resolved.auth.env,
        signal,
        cacheRetention: "none",
      },
    );
  } catch (error) {
    throw new Error(
      `Vision model ${modelRef} request failed: ${safeUpstreamMessage((error as Error).message, resolved.auth.apiKey)}`,
    );
  }

  if (response.stopReason === "error") {
    throw new Error(
      `Vision model ${modelRef} returned an error: ${safeUpstreamMessage(response.errorMessage, resolved.auth.apiKey)}`,
    );
  }

  const answer = answerText(response);
  if (!answer) {
    throw new Error(`Vision model ${modelRef} returned no text (stopReason: ${response.stopReason}).`);
  }

  return {
    content: [{ type: "text", text: answer }],
    details: { model: modelRef, imageCount: images.length },
  };
}

export function registerImageAskTool(pi: ExtensionAPI, completeFn: CompleteFn = complete): void {
  pi.registerTool({
    name: TOOL_NAME,
    label: "Image Ask",
    description:
      "Ask a vision-capable model about local image files and get a text answer. Use this when you need to know what an image shows — screenshots, mockups, diagrams, error dialogs. Pass related images together to compare them.",
    promptSnippet: "Ask a vision model about local image files, get a text answer",
    promptGuidelines: [
      `Use ${TOOL_NAME} whenever the work depends on what an image shows; do not guess an image's contents from its filename.`,
      `${TOOL_NAME} answers only the question asked, so ask for the specific detail you need, and ask again for follow-ups.`,
    ],
    parameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      return runImageAsk(params, ctx, signal, completeFn);
    },
  });
}
