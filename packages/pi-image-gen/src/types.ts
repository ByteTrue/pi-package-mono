export type ApiStyle = 'openai' | 'gemini' | 'dashscope' | 'openrouter' | 'ark';

/** Built-in provider id. Currently 1:1 with ApiStyle. */
export type BuiltInProviderId = ApiStyle;

/** A known model of a provider, with an optional local alias. */
export type ImageModelEntry = {
  /** Model id sent to the provider (e.g. "qwen-image-2.0"). */
  id: string;
  /** Optional alias the user may prefer to see and in output filenames. */
  alias?: string;
  /** Optional display name. */
  name?: string;
};

/**
 * One provider row. Built-in ids carry an implicit template (protocol, default
 * base URL, standard env credential), so they may omit `api` and may exist
 * without any row at all. Custom ids must state `api`.
 */
export type ImageProvider = {
  /**
   * Image-API wire shape this provider speaks. Required for custom providers;
   * derived from the id for built-ins.
   *
   * Note: this is NOT pi.dev custom providers' `api` field (`openai-completions`,
   * `anthropic-messages`, ...). Those are LLM streaming formats; the values here
   * are image-generation API shapes.
   */
  api?: ApiStyle;
  /** Optional display name. */
  name?: string;
  /** Override the API base URL. Optional; defaults to the protocol's default. */
  baseUrl?: string;
  /** API key. Supports `$ENV_VAR` and `${ENV_VAR}`. `""` is a tombstone: no credential. */
  apiKey?: string;
  /** Extra headers merged into every outbound request. `{}` is a tombstone. */
  headers?: Record<string, string>;
  /**
   * Known models and aliases for this provider. Presentation and lookup only —
   * the default route names its model explicitly, so an empty list never means
   * "reject this model".
   */
  models?: Array<string | ImageModelEntry>;
};

/** The single route the Skill CLI generates with. */
export type DefaultRoute = {
  provider: string;
  model: string;
};

export type ImageGenSettings = {
  /** On-disk layout version. Written as 2; a missing field means legacy v1. */
  version?: number;
  /** Which provider and remote model to use. */
  default?: DefaultRoute;
  /**
   * Where to write generated images. Relative paths resolve against the session cwd.
   * Default: `.pi/images`.
   */
  outputDir?: string;
  /** All configured providers, built-in and custom, keyed by provider id. */
  providers?: Record<string, ImageProvider>;
};

export type GenerateImageParams = {
  prompt: string;
  /**
   * Optional reference / input images for image-to-image, editing, style
   * transfer, or character preservation. Each entry MUST be either:
   *   - an absolute or relative file path on the local filesystem, or
   *   - an http(s) URL.
   *
   * `data:` URIs and raw base64 strings are intentionally rejected — tool
   * arguments don't survive megabyte-sized strings cleanly across providers.
   * If you have raw image bytes, write them to a file first.
   */
  image?: string[];
  /** Number of images to generate. Default 1. */
  n?: number;
  /** Image size hint (e.g. "1024x1024"). Provider may ignore. */
  size?: string;
  /** Output filename prefix. */
  filename?: string;
  /** Override settings.outputDir for this call. */
  outputDir?: string;
};

/** Materialized reference image, ready for adapters to encode. */
export type ResolvedImageInput = {
  bytes: Uint8Array;
  mimeType: string;
};

export type GeneratedImage = {
  /** Absolute path on disk where the image was saved. */
  path: string;
  /** Image MIME type, e.g. "image/png". */
  mimeType: string;
  /** Pass-through revised prompt if the provider returned one (e.g. OpenAI). */
  revisedPrompt?: string;
};

export type ImageGenResult = {
  model: string;
  provider: string;
  images: GeneratedImage[];
};

/** Resolved provider entry: either a built-in or a custom one. */
export type ResolvedProvider = {
  /** Provider key as referenced by the user (e.g. "openai", "my-stable-diffusion"). */
  id: string;
  api: ApiStyle;
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  /** Display label. */
  name: string;
  /** True for built-in providers (openai/gemini/dashscope/openrouter). */
  builtIn: boolean;
};

/** Result of resolving a model string to a provider + remote model id. */
export type ResolvedModel = {
  provider: ResolvedProvider;
  /** The id passed to the remote provider. */
  remoteId: string;
  /** The id the user asked for (alias or remoteId). */
  requestedId: string;
};

/** Adapter interface implemented by each api shape. */
export type ImageProviderAdapter = {
  generate(
    provider: ResolvedProvider,
    remoteModelId: string,
    params: GenerateImageParams,
    fetchImpl: typeof fetch,
    signal?: AbortSignal,
    inputs?: ResolvedImageInput[],
  ): Promise<RawImageResult[]>;
};

export type RawImageResult = {
  /** Either base64 PNG bytes or a URL to fetch. */
  data: { kind: 'base64'; bytes: string; mimeType?: string } | { kind: 'url'; url: string };
  revisedPrompt?: string;
};
