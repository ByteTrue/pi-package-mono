import { basename, extname } from 'node:path';
import type { ImageGenResult } from './types.js';

export function altFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const base = basename(normalized);
  const ext = extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  return (stem || 'image').replace(/]/g, '\\]');
}

export function formatImageResult(result: ImageGenResult): string {
  const lines = result.images.flatMap((image) => [
    `![${altFromPath(image.path)}](${image.path})`,
    ...(image.revisedPrompt ? [`> revised prompt: ${image.revisedPrompt}`] : []),
  ]);
  return [
    `Generated ${result.images.length} image(s) via ${result.provider} (${result.model}). Show each one to the user as inline markdown — copy the lines below verbatim into your reply:`,
    '',
    ...lines,
  ].join('\n');
}
