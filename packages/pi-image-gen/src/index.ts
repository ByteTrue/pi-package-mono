import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { runImageGenCommand } from './config-command.js';

export { altFromPath, formatImageResult } from './format.js';

export default function imageGenExtension(pi: ExtensionAPI): void {
  pi.registerCommand('image-gen', {
    description: 'Configure the image generation model, credentials, and output',
    handler: async (args, ctx) => runImageGenCommand(ctx, args),
  });
}
