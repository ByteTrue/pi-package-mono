/**
 * Shared types for @bytetrue/pi-subagent.
 *
 * These are the locked contracts for the whole package — later phases fill in
 * function bodies but must not change these shapes.
 *
 * Note on the model type: pi's own `.d.ts` files type the model as `Model<any>`
 * imported from `@earendil-works/pi-ai`, but that package is not a direct
 * dependency of this one and `@earendil-works/pi-coding-agent` does not re-export
 * the `Model` type. To stay decoupled we derive the model type structurally from
 * a value pi *does* expose: `ExtensionContext["model"]`.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** The pi model object, derived structurally to avoid importing the pi-ai package. */
export type PiModel = NonNullable<ExtensionContext["model"]>;

/** Where a profile came from; controls override precedence (project > user > builtin). */
export type ProfileSource = "builtin" | "user" | "project";

/**
 * Raw YAML frontmatter of an agent `.md` file, before normalization/validation.
 * `tools` / `disallowedTools` are comma-separated strings as written by the user.
 */
export interface AgentFrontmatter {
	/** Required. The subagent identity used by `subagent_type`. */
	name: string;
	/** Required. Routing hint the main agent reads to decide when to delegate. */
	description: string;
	/** Comma-separated tool allowlist. Omitted = inherit all tools. */
	tools?: string;
	/** Comma-separated tool denylist. Subtracted before the allowlist is applied. */
	disallowedTools?: string;
	/** "inherit" | alias (opus|sonnet|haiku|fable) | "provider/model-id". */
	model?: string;
	/** Optional UI accent color name. */
	color?: string;
}

/** A normalized, ready-to-run agent definition. */
export interface AgentProfile {
	/** Identity (from frontmatter `name`, not the file name). */
	name: string;
	/** Routing hint shown to the main agent. */
	description: string;
	/** The subagent's system prompt (the Markdown body). */
	systemPrompt: string;
	/** Parsed tool allowlist. `undefined` means inherit all tools. */
	tools?: string[];
	/** Parsed tool denylist, subtracted first. */
	disallowedTools?: string[];
	/** Raw model spec; resolved to a concrete model by `model.ts`. */
	model?: string;
	/** Optional UI accent color name. */
	color?: string;
	/** Origin of this profile; drives precedence on name collisions. */
	source: ProfileSource;
	/** Absolute path to the source file. Absent for built-ins. */
	filePath?: string;
}

/** Minimal slice of `ExtensionContext` the model resolver needs. */
export type ModelResolveContext = Pick<ExtensionContext, "modelRegistry" | "model">;

/** Result of resolving a model spec to a concrete model (or a documented fallback). */
export interface ModelResolution {
	/** Resolved model, or `undefined` to let `createAgentSession` pick its default. */
	model: PiModel | undefined;
	/** Resolved model id (best-effort, for reporting). */
	modelId: string;
	/** Resolved provider name (best-effort, for reporting). */
	provider: string;
	/** Set when the requested spec could not be honored and a fallback was used. */
	warning?: string;
}
