/**
 * Resolve an agent `model` spec to a concrete pi model.
 *
 * Spec grammar (deliberately tiny — no aliases):
 *   - undefined | "inherit" -> use the main agent's current model (ctx.model)
 *   - "provider/model-id"   -> ctx.modelRegistry.find(provider, modelId)
 * Unknown/unavailable specs fail soft: return a fallback with a `warning`.
 *
 * Built-in profiles all default to "inherit". Concrete per-agent models are
 * chosen via the `/subagent` command, which writes a "provider/model-id" string
 * into the config — so there's no alias guessing to get wrong across providers.
 */

import type { ModelResolution, ModelResolveContext, PiModel } from "./types.js";

/** Shape a found model into a successful resolution (no warning). */
function resolved(model: PiModel): ModelResolution {
	return { model, modelId: model.id, provider: model.provider };
}

/** Resolution that reuses the main agent's model (the "inherit" outcome). */
function inheritResolution(ctx: ModelResolveContext, warning?: string): ModelResolution {
	return {
		model: ctx.model,
		modelId: ctx.model?.id ?? "inherit",
		provider: ctx.model?.provider ?? "inherit",
		...(warning ? { warning } : {}),
	};
}

/**
 * @param spec Raw model spec from the agent profile/config (may be undefined).
 * @param ctx  Model registry + current model, sliced from ExtensionContext.
 */
export function resolveModel(spec: string | undefined, ctx: ModelResolveContext): ModelResolution {
	const trimmed = spec?.trim();

	// inherit: undefined or explicit "inherit" -> reuse the main agent's model.
	if (!trimmed || trimmed === "inherit") return inheritResolution(ctx);

	// explicit "provider/model-id".
	if (trimmed.includes("/")) {
		const slash = trimmed.indexOf("/");
		const provider = trimmed.slice(0, slash).trim();
		const modelId = trimmed.slice(slash + 1).trim();
		if (provider && modelId) {
			const model = ctx.modelRegistry.find(provider, modelId);
			if (model) return resolved(model);
		}
		return inheritResolution(ctx, `Model "${trimmed}" not found; falling back to the main model.`);
	}

	// Anything else (a bare token) isn't resolvable — fail soft to inherit.
	return inheritResolution(
		ctx,
		`Model "${trimmed}" must be "inherit" or "provider/model-id"; falling back to the main model.`,
	);
}
