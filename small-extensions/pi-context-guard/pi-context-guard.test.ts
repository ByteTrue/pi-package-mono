import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import contextGuardDefault, {
	applyContextWindowRestorations,
	applyContextWindowUpdates,
	discoverModels,
	findModelObjectRange,
	makeKey,
	parseThreshold,
	readOriginalsStore,
	registerContextGuard,
	removeModelObjectContextWindow,
	restoreModelObjectContextWindow,
	sessionFileSection,
	stripJsonComments,
	updateModelObjectContextWindow,
} from "./pi-context-guard.js";

function beforeAgentStartEvent() {
	return {
		type: "before_agent_start" as const,
		prompt: "hi",
		images: undefined,
		systemPrompt: "system",
		systemPromptOptions: {
			cwd: "/tmp",
			selectedTools: [],
			hiddenTools: [],
			toolSnippets: {},
			toolGuidelines: {},
			promptGuidelines: [],
			appendSystemPrompt: "",
			sections: {} as Record<string, string>,
			contextFiles: [],
			skills: [],
		},
	};
}

describe("parseThreshold", () => {
	it("parses valid token numbers and units", () => {
		expect(parseThreshold("300k")).toBe(300_000);
		expect(parseThreshold("300K")).toBe(300_000);
		expect(parseThreshold("1.5m")).toBe(1_500_000);
		expect(parseThreshold("1M")).toBe(1_000_000);
		expect(parseThreshold("400000")).toBe(400_000);
		expect(parseThreshold(400_000)).toBe(400_000);
	});

	it("returns null for invalid inputs", () => {
		expect(parseThreshold("")).toBeNull();
		expect(parseThreshold("abc")).toBeNull();
		expect(parseThreshold("0")).toBeNull();
		expect(parseThreshold("-500")).toBeNull();
		expect(parseThreshold(null)).toBeNull();
		expect(parseThreshold(undefined)).toBeNull();
	});
});

describe("discoverModels", () => {
	it("finds models and modelOverrides correctly", () => {
		const json = JSON.stringify({
			providers: {
				prov1: {
					models: [
						{ id: "m1", contextWindow: 1_000_000 },
						{ id: "m2" },
					],
					modelOverrides: {
						ov1: { contextWindow: 500_000 },
					},
				},
			},
		});
		const models = discoverModels(json);
		expect(models).toEqual([
			{ provider: "prov1", modelId: "m1", kind: "model", contextWindow: 1_000_000 },
			{ provider: "prov1", modelId: "m2", kind: "model", contextWindow: undefined },
			{ provider: "prov1", modelId: "ov1", kind: "override", contextWindow: 500_000 },
		]);
	});

	it("finds models even when models.json contains comments (P0 regression)", () => {
		const commentedJson = `{
  // User custom comment for providers
  "providers": {
    /* block comment */
    "prov1": {
      "baseUrl": "https://api.example.com//v1", // contains double slash in url string!
      "models": [
        { "id": "m1" }
      ]
    }
  }
}`;
		const models = discoverModels(commentedJson);
		expect(models).toEqual([
			{ provider: "prov1", modelId: "m1", kind: "model", contextWindow: undefined },
		]);
	});

	it("returns empty list on malformed or empty documents", () => {
		expect(discoverModels("invalid json")).toEqual([]);
		expect(discoverModels("{}")).toEqual([]);
		expect(discoverModels(JSON.stringify({ providers: null }))).toEqual([]);
	});
});

describe("findModelObjectRange", () => {
	const doc = `{
  "providers": {
    "p1": {
      "headers": {
        "override-b": { "secret": "foo" }
      },
      "models": [
        {
          "id": "model-a",
          "contextWindow": 1000000
        }
      ],
      "modelOverrides": {
        "override-b": {
          "contextWindow": 200000
        }
      }
    }
  }
}`;

	it("locates model array entries exactly", () => {
		const range = findModelObjectRange(doc, "p1", "model-a", "model");
		expect(range).not.toBeNull();
		const slice = doc.slice(range!.start, range!.end + 1);
		expect(slice).toContain('"id": "model-a"');
		expect(slice).toContain('"contextWindow": 1000000');
	});

	it("locates override entries strictly inside modelOverrides (P2 regression)", () => {
		const range = findModelObjectRange(doc, "p1", "override-b", "override");
		expect(range).not.toBeNull();
		const slice = doc.slice(range!.start, range!.end + 1);
		expect(slice).toContain('"contextWindow": 200000');
		expect(slice).not.toContain('"secret": "foo"');
	});

	it("returns null when provider or model does not exist", () => {
		expect(findModelObjectRange(doc, "unknown-provider", "model-a", "model")).toBeNull();
		expect(findModelObjectRange(doc, "p1", "unknown-model", "model")).toBeNull();
	});
});

describe("updateModelObjectContextWindow", () => {
	it("replaces existing contextWindow in place", () => {
		const obj = `{
          "id": "m1",
          "contextWindow": 1000000,
          "name": "M1"
        }`;
		const updated = updateModelObjectContextWindow(obj, 300_000);
		expect(updated).toContain('"contextWindow": 300000,');
		expect(updated).toContain('"name": "M1"');
		expect(JSON.parse(updated)).toEqual({
			id: "m1",
			contextWindow: 300_000,
			name: "M1",
		});
	});

	it("inserts contextWindow when absent in model with id", () => {
		const obj = `{
          "id": "m2",
          "name": "M2"
        }`;
		const updated = updateModelObjectContextWindow(obj, 250_000);
		expect(updated).toContain('"contextWindow": 250000');
		expect(JSON.parse(updated)).toEqual({
			id: "m2",
			contextWindow: 250_000,
			name: "M2",
		});
	});

	it("inserts contextWindow in empty override object without trailing comma (P0 regression)", () => {
		const obj = `{}`;
		const updated = updateModelObjectContextWindow(obj, 128_000);
		expect(updated).not.toContain(",}");
		expect(updated).not.toContain(",\n}");
		expect(JSON.parse(updated)).toEqual({
			contextWindow: 128_000,
		});

		const objWithSpace = `{ }`;
		const updatedSpace = updateModelObjectContextWindow(objWithSpace, 128_000);
		expect(JSON.parse(updatedSpace)).toEqual({
			contextWindow: 128_000,
		});
	});

	it("inserts contextWindow when absent in override object with other properties", () => {
		const obj = `{
          "maxTokens": 4096
        }`;
		const updated = updateModelObjectContextWindow(obj, 200_000);
		expect(updated).toContain('"contextWindow": 200000');
		expect(JSON.parse(updated)).toEqual({
			contextWindow: 200_000,
			maxTokens: 4096,
		});
	});
});

describe("removeModelObjectContextWindow & restoration", () => {
	it("removes contextWindow when it is followed by other properties", () => {
		const obj = `{
  "id": "m1",
  "contextWindow": 300000,
  "name": "M1"
}`;
		const removed = removeModelObjectContextWindow(obj);
		expect(removed).not.toContain("contextWindow");
		expect(JSON.parse(removed)).toEqual({ id: "m1", name: "M1" });
	});

	it("removes contextWindow when it is the trailing property", () => {
		const obj = `{
  "id": "m2",
  "contextWindow": 300000
}`;
		const removed = removeModelObjectContextWindow(obj);
		expect(removed).not.toContain("contextWindow");
		expect(JSON.parse(removed)).toEqual({ id: "m2" });
	});

	it("removes contextWindow when preceding property has inline comments (P1 regression)", () => {
		const obj = `{
  "id": "m1", // comment after id
  "contextWindow": 300000
}`;
		const removed = removeModelObjectContextWindow(obj);
		expect(removed).not.toContain("contextWindow");
		// Stripping comments must yield valid JSON without trailing comma after m1
		expect(JSON.parse(stripJsonComments(removed))).toEqual({ id: "m1" });
	});

	it("restores either explicit number or removes field if originally null", () => {
		const withVal = restoreModelObjectContextWindow(`{ "id": "m1", "contextWindow": 200 }`, 1000);
		expect(JSON.parse(withVal)).toEqual({ id: "m1", contextWindow: 1000 });

		const withoutVal = restoreModelObjectContextWindow(`{ "id": "m2", "contextWindow": 200 }`, null);
		expect(JSON.parse(withoutVal)).toEqual({ id: "m2" });
	});
});

describe("applyContextWindowRestorations", () => {
	it("restores models accurately across entire document", () => {
		const doc = `{
  "providers": {
    "local": {
      "models": [
        {
          "id": "m1",
          "contextWindow": 300000,
          "name": "M1"
        },
        {
          "id": "m2",
          "contextWindow": 300000
        }
      ]
    }
  }
}`;
		const restored = applyContextWindowRestorations(doc, [
			{ providerKey: "local", modelId: "m1", kind: "model", originalValue: 1_000_000 },
			{ providerKey: "local", modelId: "m2", kind: "model", originalValue: null },
		]);
		const parsed = JSON.parse(restored);
		expect(parsed.providers.local.models[0].contextWindow).toBe(1_000_000);
		expect(parsed.providers.local.models[1].contextWindow).toBeUndefined();
	});
});

describe("applyContextWindowUpdates", () => {
	it("surgically updates multiple models and keeps comments untouched", () => {
		const sampleDoc = `{
  // Custom comment to verify non-destructive update
  "providers": {
    "my-provider": {
      "baseUrl": "https://example.com/v1",
      "models": [
        {
          "id": "model-keep",
          "contextWindow": 999999
        },
        {
          "id": "model-update",
          "contextWindow": 1000000,
          "name": "Needs change"
        }
      ]
    }
  }
}`;
		const updated = applyContextWindowUpdates(sampleDoc, [
			{ providerKey: "my-provider", modelId: "model-update", kind: "model", threshold: 300_000 },
		]);
		expect(updated).toContain("// Custom comment to verify non-destructive update");
		expect(updated).toContain('"contextWindow": 999999');
		expect(updated).toContain('"contextWindow": 300000');
		expect(updated).toContain('"name": "Needs change"');
	});
});

describe("makeKey", () => {
	it("includes kind to avoid key collision between model and override (P1 regression)", () => {
		const k1 = makeKey("prov", "m1", "model");
		const k2 = makeKey("prov", "m1", "override");
		expect(k1).not.toBe(k2);
		expect(k1).toBe("prov::model::m1");
		expect(k2).toBe("prov::override::m1");
	});
});

describe("registerContextGuard & slash command flow", () => {
	let testDir: string;
	let originalAgentDir: string | undefined;

	beforeEach(() => {
		testDir = join(tmpdir(), `pi-test-cg-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(testDir, { recursive: true });
		originalAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = testDir;
	});

	afterEach(() => {
		if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
		try {
			rmSync(testDir, { recursive: true, force: true });
		} catch {
			// ignore cleanup error
		}
	});

	it("registers /context command and before_agent_start hook", () => {
		const commands: Record<string, { description: string; handler: Function }> = {};
		const handlers: Record<string, Function> = {};
		const pi = {
			registerCommand(name: string, def: { description: string; handler: Function }) {
				commands[name] = def;
			},
			on(event: string, handler: Function) {
				handlers[event] = handler;
			},
		} as unknown as ExtensionAPI;

		contextGuardDefault(pi);
		expect(commands.context).toBeDefined();
		expect(handlers.before_agent_start).toBeDefined();
	});

	it("points system prompt at session file in before_agent_start", () => {
		const handlers: Record<string, Function> = {};
		const pi = {
			registerCommand: () => {},
			on: (e: string, h: Function) => {
				handlers[e] = h;
			},
		} as unknown as ExtensionAPI;
		registerContextGuard(pi);

		const ctx = {
			sessionManager: { getSessionFile: () => "/tmp/session-123.jsonl" },
		};
		const event = beforeAgentStartEvent();
		handlers.before_agent_start?.(event, ctx);
		expect(event.systemPromptOptions.sections.session_file).toBe(sessionFileSection("/tmp/session-123.jsonl"));
	});

	it("modifies models.json and then restores original parameters end-to-end", async () => {
		const modelsJsonPath = join(testDir, "models.json");
		const initialJson = `{
  "providers": {
    "local": {
      "models": [
        {
          "id": "qwen",
          "contextWindow": 1000000
        },
        {
          "id": "deepseek"
        }
      ]
    }
  }
}`;
		writeFileSync(modelsJsonPath, initialJson, "utf8");

		let commandHandler: Function | undefined;
		const pi = {
			registerCommand(_name: string, def: { handler: Function }) {
				commandHandler = def.handler;
			},
			on: () => {},
		} as unknown as ExtensionAPI;
		registerContextGuard(pi);

		const notifications: { message: string; type?: string }[] = [];

		// 1. First run: modify both models to 400k
		let selectCallCount = 0;
		const setCtx = {
			hasUI: true,
			ui: {
				notify: (message: string, type?: string) => notifications.push({ message, type }),
				input: async () => "400k",
				select: async (_title: string, choices: string[]) => {
					selectCallCount++;
					if (selectCallCount === 1) {
						// Select all models
						return choices.find((c) => c.includes("Select all models"));
					}
					// Confirm
					return choices.find((c) => c.includes("Confirm and save"));
				},
			},
		} as unknown as ExtensionCommandContext;

		await commandHandler?.("400k", setCtx);

		const modifiedJson = readFileSync(modelsJsonPath, "utf8");
		const parsedModified = JSON.parse(modifiedJson);
		expect(parsedModified.providers.local.models[0].contextWindow).toBe(400_000);
		expect(parsedModified.providers.local.models[1].contextWindow).toBe(400_000);

		// Verify originals store captured correct values
		const store = readOriginalsStore();
		expect(store["local::model::qwen"]?.contextWindow).toBe(1_000_000);
		expect(store["local::model::deepseek"]?.contextWindow).toBeNull();

		// 2. Second run: restore all models
		let restoreSelectCount = 0;
		const restoreCtx = {
			hasUI: true,
			ui: {
				notify: (message: string, type?: string) => notifications.push({ message, type }),
				select: async (_title: string, choices: string[]) => {
					restoreSelectCount++;
					if (restoreSelectCount === 1) {
						// Select all
						return choices.find((c) => c.includes("Select all models"));
					}
					// Confirm restore
					return choices.find((c) => c.includes("Restore selected"));
				},
			},
		} as unknown as ExtensionCommandContext;

		await commandHandler?.("restore", restoreCtx);

		const restoredJson = readFileSync(modelsJsonPath, "utf8");
		const parsedRestored = JSON.parse(restoredJson);
		expect(parsedRestored.providers.local.models[0].contextWindow).toBe(1_000_000);
		expect(parsedRestored.providers.local.models[1].contextWindow).toBeUndefined();

		// Originals store should have cleared restored records
		const storeAfter = readOriginalsStore();
		expect(storeAfter["local::model::qwen"]).toBeUndefined();
		expect(storeAfter["local::model::deepseek"]).toBeUndefined();
	});
});
