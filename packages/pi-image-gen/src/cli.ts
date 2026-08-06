import type { GenerateImageParams, ImageGenResult, ImageGenSettings } from './types.js';
import { generateImage } from './generate.js';
import { formatImageResult } from './format.js';
import { isCliProjectTrusted, loadImageGenSettings } from './settings.js';
import { ENV_VARS } from './models.js';
import { configEnvironmentValues, resolveConfigString, resolveModel } from './config.js';

const MAX_REQUEST_BYTES = 1024 * 1024;
const REQUEST_KEYS = new Set(['prompt', 'image', 'n', 'size', 'filename', 'outputDir']);

export function parseCliRequest(text: string): GenerateImageParams {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Request must be valid JSON on stdin.');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Request must be a JSON object.');
  }
  const object = raw as Record<string, unknown>;
  const unknown = Object.keys(object).filter((key) => !REQUEST_KEYS.has(key));
  if (unknown.length) throw new Error(`Unknown request field(s): ${unknown.join(', ')}.`);
  if (typeof object.prompt !== 'string' || !object.prompt.trim()) {
    throw new Error('prompt must be a non-empty string.');
  }
  if (
    object.image !== undefined &&
    (!Array.isArray(object.image) || object.image.some((value) => typeof value !== 'string' || !value))
  ) {
    throw new Error('image must be an array of non-empty paths or URLs.');
  }
  if (
    object.n !== undefined &&
    (!Number.isSafeInteger(object.n) || (object.n as number) < 1 || (object.n as number) > 8)
  ) {
    throw new Error('n must be an integer from 1 to 8.');
  }
  for (const field of ['size', 'filename', 'outputDir'] as const) {
    if (object[field] !== undefined && typeof object[field] !== 'string') {
      throw new Error(`${field} must be a string.`);
    }
  }
  return object as unknown as GenerateImageParams;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_REQUEST_BYTES) throw new Error(`Request exceeds ${MAX_REQUEST_BYTES} bytes.`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function collectSecrets(settings: ImageGenSettings): string[] {
  const values: string[] = Object.values(ENV_VARS).flatMap((name) => {
    const value = process.env[name];
    return value ? [value] : [];
  });
  for (const provider of [
    ...Object.values(settings.providers ?? {}),
    ...Object.values(settings.customProviders ?? {}),
  ]) {
    if (provider.apiKey) {
      values.push(provider.apiKey, resolveConfigString(provider.apiKey) ?? '', ...configEnvironmentValues(provider.apiKey));
    }
    for (const [name, value] of Object.entries(provider.headers ?? {})) {
      const resolved = resolveConfigString(value);
      values.push(value, resolved ?? '', ...configEnvironmentValues(value));
      if (/^(?:proxy-)?authorization$/i.test(name) && resolved) {
        const credential = resolved.match(/^\S+\s+(.+)$/)?.[1];
        if (credential) values.push(credential);
      }
    }
    values.push(...configEnvironmentValues(provider.baseUrl));
    const baseUrl = resolveConfigString(provider.baseUrl);
    if (baseUrl) {
      try {
        const parsed = new URL(baseUrl);
        if (parsed.username) values.push(decodeURIComponent(parsed.username));
        if (parsed.password) values.push(decodeURIComponent(parsed.password));
      } catch {
        // URL validation belongs to the provider adapter; redaction stays best-effort.
      }
    }
  }
  return [...new Set(values.filter(Boolean))].sort((a, b) => b.length - a.length);
}

export function redactCliText(text: string, settings: ImageGenSettings): string {
  let redacted = text;
  for (const secret of collectSecrets(settings)) redacted = redacted.split(secret).join('[redacted]');
  return redacted;
}

export function safeCliError(error: unknown, settings: ImageGenSettings): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactCliText(message, settings).slice(0, 1000);
}

export interface ImageGenCliOptions {
  args?: string[];
  cwd?: string;
  input?: string;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  generate?: (
    request: GenerateImageParams,
    options: Parameters<typeof generateImage>[1],
  ) => Promise<ImageGenResult>;
}

const HELP = `Usage:
  image-gen.mjs generate    # read one JSON request from stdin
  image-gen.mjs --list      # show the effective non-secret route

Request fields: prompt (required), image[], n (1-8), size, filename, outputDir.
Run /image-gen in Pi to configure the model and credentials.`;

export async function runImageGenCli(options: ImageGenCliOptions = {}): Promise<number> {
  const args = options.args ?? process.argv.slice(2);
  const cwd = options.cwd ?? process.cwd();
  const stdout = options.stdout ?? ((text: string) => process.stdout.write(`${text}\n`));
  const stderr = options.stderr ?? ((text: string) => process.stderr.write(`${text}\n`));
  const settings = loadImageGenSettings(cwd, isCliProjectTrusted(cwd));

  if (args.includes('--help') || args.includes('-h')) {
    stdout(HELP);
    return 0;
  }
  if (args.includes('--list')) {
    const lines = [
      `Default model: ${settings.defaultModel ?? 'not configured'}`,
      `Output directory: ${settings.outputDir ?? '.pi/images'}`,
      `Project settings: ${isCliProjectTrusted(cwd) ? 'trusted and active' : 'not active'}`,
    ];
    if (settings.defaultModel) {
      const resolved = resolveModel(settings.defaultModel, settings);
      if ('error' in resolved) lines.push(`Route: ${resolved.error}`);
      else {
        lines.push(`Provider: ${resolved.provider.name} (${resolved.provider.api})`);
        lines.push(`Credential: ${resolved.provider.apiKey ? 'configured (hidden)' : 'missing / not required'}`);
      }
    }
    stdout(lines.join('\n'));
    return settings.defaultModel ? 0 : 1;
  }
  if (args.length > 1 || (args.length === 1 && args[0] !== 'generate')) {
    stderr(HELP);
    return 2;
  }

  const controller = new AbortController();
  const abort = () => controller.abort(new Error('Image generation cancelled.'));
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  try {
    const request = parseCliRequest(options.input ?? (await readStdin()));
    const result = await (options.generate ?? generateImage)(request, {
      cwd,
      settings,
      signal: controller.signal,
    });
    stdout(redactCliText(formatImageResult(result), settings));
    return 0;
  } catch (error) {
    stderr(`Image generation failed: ${safeCliError(error, settings)}`);
    return 1;
  } finally {
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
  }
}
