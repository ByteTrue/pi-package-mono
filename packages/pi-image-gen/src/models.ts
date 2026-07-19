import type { ApiStyle, BuiltInProviderId } from './types.js';

/**
 * Built-in known image models. Maps a model id (or alias) to its built-in
 * provider. Custom providers may add or override entries via settings.
 */
export type BuiltInModelEntry = {
  id: string;
  aliases?: string[];
  provider: BuiltInProviderId;
  /** Remote model id sent to the provider (defaults to id). */
  remoteId?: string;
};

export const BUILT_IN_MODELS: BuiltInModelEntry[] = [
  // OpenAI image generation.
  {
    id: 'gpt-image-2',
    provider: 'openai',
  },

  // Google Gemini "Nano Banana" image generation.
  // Per https://ai.google.dev/gemini-api/docs/image-generation:
  //   Nano Banana Pro      → gemini-3-pro-image
  //   Nano Banana 2        → gemini-3.1-flash-image
  //   Nano Banana 2 Lite   → gemini-3.1-flash-lite-image
  //   Nano Banana          → gemini-2.5-flash-image
  {
    id: 'gemini-3-pro-image',
    aliases: ['nano-banana-pro'],
    provider: 'gemini',
  },
  {
    id: 'gemini-3.1-flash-image',
    aliases: ['nano-banana-2'],
    provider: 'gemini',
  },
  {
    id: 'gemini-3.1-flash-lite-image',
    aliases: ['nano-banana-2-lite'],
    provider: 'gemini',
  },
  {
    id: 'gemini-2.5-flash-image',
    aliases: ['nano-banana'],
    provider: 'gemini',
  },

  // Alibaba Qwen-Image / WanX series via DashScope.
  {
    id: 'qwen-image-2.0-pro',
    provider: 'dashscope',
  },
  {
    id: 'qwen-image-2.0',
    provider: 'dashscope',
  },

  // ByteDance Seedream via Volcengine Ark. The `seedream` alias points at the
  // latest stable Seedream release.
  // Docs: https://www.volcengine.com/docs/82379/1824121
  {
    id: 'doubao-seedream-5-0-pro-260128',
    aliases: ['seedream-5-pro'],
    provider: 'ark',
  },
  {
    id: 'doubao-seedream-5-0-260128',
    aliases: ['seedream-5', 'seedream'],
    provider: 'ark',
  },
  {
    id: 'doubao-seedream-5-0-lite-260128',
    aliases: ['seedream-5-lite'],
    provider: 'ark',
  },
  {
    id: 'doubao-seedream-4-5-251128',
    aliases: ['seedream-4-5'],
    provider: 'ark',
  },
  {
    id: 'doubao-seedream-4-0-250828',
    aliases: ['seedream-4'],
    provider: 'ark',
  },
];

export const DEFAULT_BASE_URL: Record<BuiltInProviderId, string> = {
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  dashscope: 'https://dashscope.aliyuncs.com/api/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  ark: 'https://ark.cn-beijing.volces.com/api/v3',
};

export const DEFAULT_API_STYLE: Record<BuiltInProviderId, ApiStyle> = {
  openai: 'openai',
  gemini: 'gemini',
  dashscope: 'dashscope',
  openrouter: 'openrouter',
  ark: 'ark',
};

export const ENV_VARS: Record<BuiltInProviderId, string> = {
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  dashscope: 'DASHSCOPE_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  ark: 'ARK_API_KEY',
};

export const PROVIDER_DISPLAY_NAME: Record<BuiltInProviderId, string> = {
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  dashscope: 'Alibaba DashScope',
  openrouter: 'OpenRouter',
  ark: 'Volcengine Ark',
};
