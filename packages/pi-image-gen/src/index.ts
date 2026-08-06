import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { runImageGenCommand } from './config-command.js';
import { exposeProjectTrustToCli } from './settings.js';

export { altFromPath, formatImageResult, formatToolResultText } from './format.js';

export default function imageGenExtension(pi: ExtensionAPI): void {
  pi.registerCommand('image-gen', {
    description: 'Configure the image generation model, credentials, and output',
    handler: async (args, ctx) => runImageGenCommand(ctx, args),
  });

  pi.on('session_start', (_event, ctx) => {
    exposeProjectTrustToCli(ctx.cwd, ctx.isProjectTrusted());
  });
}
