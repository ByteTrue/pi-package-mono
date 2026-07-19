import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import {
  listConfiguredProviders,
  listKnownModelIds,
  loadImageGenSettings,
  resolveModel,
} from './config.js';
import { generateImage } from './generate.js';
import type { GenerateImageParams, ImageGenResult, ImageGenSettings } from './types.js';

export { loadImageGenSettings, resolveModel } from './config.js';
export { generateImage } from './generate.js';
export type { GenerateImageParams, ImageGenSettings } from './types.js';

/**
 * Forked from TGYD-helige/pi `packages/pi-image-gen` (Apache-2.0).
 * Local changes are documented in ../NOTICE.
 */

export default function piImageGenExtension(pi: ExtensionAPI): void {
  let settings: ImageGenSettings = {};
  let sessionCwd = process.cwd();

  pi.on('session_start', async (_event: unknown, ctx: ExtensionContext) => {
    sessionCwd = ctx.cwd;
    settings = loadImageGenSettings(ctx.cwd);
  });

  pi.registerCommand('image-gen', {
    description: 'Inspect pi-image-gen: /image-gen [list|reload]',
    handler: async (args: string | undefined, ctx: ExtensionContext) => {
      const tokens = (args ?? '').trim().split(/\s+/).filter(Boolean);
      if (tokens[0] === 'reload') {
        settings = loadImageGenSettings(ctx.cwd);
        ctx.ui.notify('pi-image-gen settings reloaded.', 'info');
        return;
      }
      const providers = listConfiguredProviders(settings);
      const defaultModel = settings.defaultModel?.trim();
      let activeLine = `Default model: ${defaultModel ?? '(not set — configure pi-image-gen.defaultModel in settings.json)'}`;
      if (defaultModel) {
        const resolved = resolveModel(defaultModel, settings);
        if ('error' in resolved) {
          activeLine += `\n  ! ${resolved.error}`;
        } else {
          const provider = resolved.provider;
          const keyOk = Boolean(provider.apiKey);
          activeLine += `\n  routes to: ${provider.id} [${provider.api}] ${provider.builtIn ? '' : '(custom) '}${keyOk ? 'apiKey: set' : 'apiKey: MISSING'}`;
        }
      }
      const lines = [
        activeLine,
        `Output dir: ${settings.outputDir ?? '.pi/images'}`,
        '',
        'Configured providers:',
        ...(providers.length
          ? providers.map((p) => {
              const tags: string[] = [`[${p.api}]`];
              if (!p.builtIn) tags.push('(custom)');
              if (p.catchAll) tags.push('(catch-all — accepts any model)');
              else if (p.modelCount > 0)
                tags.push(`(${p.modelCount} model${p.modelCount === 1 ? '' : 's'})`);
              return `  - ${p.id} ${tags.join(' ')}`;
            })
          : [
              '  (none — set OPENAI_API_KEY / GEMINI_API_KEY / DASHSCOPE_API_KEY / OPENROUTER_API_KEY)',
            ]),
        '',
        'Built-in models:',
        ...listKnownModelIds().map((m) => `  - ${m}`),
      ];
      ctx.ui.notify(lines.join('\n'), 'info');
    },
  });

  pi.registerTool({
    name: 'image_generate',
    label: 'ImageGen',
    description:
      'Generate or edit images. The image model is fixed by pi-image-gen.defaultModel in settings (this tool does not accept a model parameter). Pass `image` to do image-to-image / edit / style transfer / character preservation: a file path (absolute or relative to cwd) or an http(s) URL. To iterate on a previous result, pass its file path back. Do NOT pass base64 or data: URIs — write bytes to a file first. Saves the output to disk and returns the absolute path(s). When reporting the result to the user, render each generated image as inline markdown `![alt](absolute_path)` (the tool result already includes a copy-pasteable line) so the UI can display it; do not just paste the bare path. Run /image-gen list to see the active model.',
    parameters: Type.Object({
      prompt: Type.String({
        description: 'Text prompt describing what to generate or how to edit.',
      }),
      image: Type.Optional(
        Type.Array(Type.String(), {
          description:
            'Optional reference image(s) for image-to-image / edit / style transfer / character preservation. Each entry MUST be either (a) a file path — absolute or relative to the session cwd — or (b) an http(s) URL. Base64 strings and data: URIs are rejected; write the bytes to a file first if you have raw image data. For a single image pass ["path"]. Multi-image conditioning is supported by OpenAI gpt-image-2, Gemini, and Qwen sync models. To iterate on a previous output, pass that file path here.',
        }),
      ),
      n: Type.Optional(
        Type.Number({
          minimum: 1,
          maximum: 8,
          description: 'Number of images. Default 1 (integer).',
        }),
      ),
      size: Type.Optional(
        Type.String({
          description:
            'Image size hint such as "1024x1024". Provider-specific; ignored if unsupported.',
        }),
      ),
      filename: Type.Optional(Type.String({ description: 'Filename prefix (without extension).' })),
      outputDir: Type.Optional(
        Type.String({
          description:
            'Directory to write images into. Relative paths resolve against the session cwd.',
        }),
      ),
    }) as never,
    async execute(_toolCallId: string, rawParams: unknown, signal, _onUpdate, ctx) {
      const params = rawParams as GenerateImageParams;
      const cwd = ctx?.cwd ?? sessionCwd;
      const opts: Parameters<typeof generateImage>[1] = { cwd, settings };
      if (signal) opts.signal = signal;
      const result = await generateImage(params, opts);
      return {
        content: [{ type: 'text' as const, text: formatToolResultText(result) }],
        details: result,
      };
    },
  });
}

/**
 * Format a generated-image result as text the LLM can paste verbatim into its
 * reply. Uses inline markdown image syntax with the file stem as the alt text.
 */
export function formatToolResultText(result: ImageGenResult): string {
  const lines: string[] = [
    `Generated ${result.images.length} image(s) via ${result.provider} (${result.model}). Show each one to the user as inline markdown — copy the lines below verbatim into your reply:`,
    '',
    ...result.images.flatMap((img) => {
      const alt = altFromPath(img.path);
      const md = `![${alt}](${img.path})`;
      return img.revisedPrompt ? [md, `> revised prompt: ${img.revisedPrompt}`] : [md];
    }),
  ];
  return lines.join('\n');
}

/**
 * Derive a markdown `alt` from the saved file path. We use the filename without
 * its extension so the user-supplied `filename` (or our auto-generated stamp)
 * shows up in the rendered image label, not the model id.
 */
export function altFromPath(absolutePath: string): string {
  const segments = absolutePath.split(/[\\/]/);
  const base = segments[segments.length - 1] ?? 'image';
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  // Escape `]` so the markdown link doesn't break if the filename has one.
  return stem.replace(/\]/g, '\\]') || 'image';
}
