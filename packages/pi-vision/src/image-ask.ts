import type { AssistantMessage, ImageContent } from "@earendil-works/pi-ai";
// ponytail: "@earendil-works/pi-ai/compat" is documented as temporary ("deleted with the
// coding-agent ModelManager migration"), but it is what pi's own examples/extensions/summarize.ts
// uses and the only entry exposing complete(). Swap for the successor API when it lands.
import { complete } from "@earendil-works/pi-ai/compat";
import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readImageFile } from "./image-file.js";
import { resolveVisionModel, type VisionAuth } from "./vision-model.js";

export const TOOL_NAME = "image_ask";

export interface ImageAskDetails {
  model: string;
  imageCount: number;
}

export interface VisionAnalysis extends ImageAskDetails {
  text: string;
  usage: AssistantMessage["usage"];
}

/** Injected so tests never touch the network. */
export type CompleteFn = typeof complete;

const parameters = Type.Object({
  paths: Type.Array(Type.String(), {
    description: "Local image paths, absolute or relative to cwd; group related images for comparison.",
  }),
  question: Type.String({ description: "A specific question about the images." }),
});

function credentialEcho(raw: string, auth: VisionAuth): "the API key" | "a configured credential" | undefined {
  if (auth.apiKey && raw.includes(auth.apiKey)) return "the API key";

  // A null header value suppresses a provider default and never carries a credential.
  const headerEntries = Object.entries(auth.headers ?? {}).filter(
    (entry): entry is [string, string] => entry[1] !== null,
  );
  const authorizationTokens = headerEntries
    .filter(([name]) => name.toLowerCase() === "authorization")
    .map(([, value]) => value.replace(/^\S+\s+/, ""));
  const otherCredentials = [
    ...headerEntries.map(([, value]) => value),
    ...authorizationTokens,
    ...Object.values(auth.env ?? {}),
  ];
  if (otherCredentials.some((value) => value && raw.includes(value))) {
    return "a configured credential";
  }
}

/** Never echo an upstream message that contains any resolved credential value. */
function safeUpstreamMessage(raw: string | undefined, auth: VisionAuth): string {
  if (!raw) return "no detail returned";
  const echo = credentialEcho(raw, auth);
  if (echo) return `detail withheld: the upstream response echoed ${echo}`;
  return raw.length > 500 ? `${raw.slice(0, 500)}…` : raw;
}

function answerText(message: AssistantMessage): string {
  return message.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n")
    .trim();
}

export async function analyzeImages(
  images: ImageContent[],
  question: string,
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
  completeFn: CompleteFn,
): Promise<VisionAnalysis> {
  if (images.length === 0) throw new Error("No images given.");
  if (!question.trim()) throw new Error("No question given.");

  const resolved = await resolveVisionModel(ctx);
  if (!resolved.ok) throw new Error(resolved.error);

  const modelRef = `${resolved.model.provider}/${resolved.model.id}`;
  let response: AssistantMessage;
  try {
    response = await completeFn(
      resolved.model,
      {
        messages: [
          {
            role: "user",
            content: [...images, { type: "text", text: question }],
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
      `Vision model ${modelRef} request failed: ${safeUpstreamMessage((error as Error).message, resolved.auth)}`,
    );
  }

  if (response.stopReason === "error") {
    throw new Error(
      `Vision model ${modelRef} returned an error: ${safeUpstreamMessage(response.errorMessage, resolved.auth)}`,
    );
  }

  const text = answerText(response);
  if (!text) {
    throw new Error(`Vision model ${modelRef} returned no text (stopReason: ${response.stopReason}).`);
  }
  const echo = credentialEcho(text, resolved.auth);
  if (echo) {
    throw new Error(`Vision model ${modelRef} response echoed ${echo}; text withheld.`);
  }

  return { text, model: modelRef, imageCount: images.length, usage: response.usage };
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

  const images: ImageContent[] = [];
  for (const path of params.paths) {
    images.push(await readImageFile(path, ctx.cwd));
  }
  const analysis = await analyzeImages(images, params.question, ctx, signal, completeFn);

  return {
    content: [{ type: "text", text: analysis.text }],
    details: { model: analysis.model, imageCount: analysis.imageCount },
  };
}

export function registerImageAskTool(pi: ExtensionAPI, completeFn: CompleteFn = complete): void {
  pi.registerTool({
    name: TOOL_NAME,
    label: "Image Ask",
    description: "Ask a vision model about local images and return a text answer.",
    promptSnippet: "Ask a vision model about local images.",
    promptGuidelines: [
      `${TOOL_NAME}: use when work depends on image contents; never infer contents from filenames.`,
    ],
    parameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      return runImageAsk(params, ctx, signal, completeFn);
    },
  });
}
