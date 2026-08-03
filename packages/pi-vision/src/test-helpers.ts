import type { Api, Model } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function makeModel(provider: string, id: string, vision = true): Model<Api> {
  return {
    id,
    provider,
    api: "openai-completions",
    name: id,
    baseUrl: "https://example.invalid/v1",
    input: vision ? ["text", "image"] : ["text"],
    reasoning: false,
    contextWindow: 1000,
    maxTokens: 100,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  } as unknown as Model<Api>;
}

export interface FakeCtxOptions {
  cwd?: string;
  models?: Model<Api>[];
  auth?: { ok: true; apiKey?: string; headers?: Record<string, string> } | { ok: false; error: string };
  model?: Model<Api>;
}

export function makeCtx(options: FakeCtxOptions = {}): ExtensionContext {
  const models = options.models ?? [];
  const auth = options.auth ?? { ok: true as const, apiKey: "test-key-123456" };
  return {
    cwd: options.cwd ?? process.cwd(),
    model: options.model,
    modelRegistry: {
      getAvailable: () => models,
      find: (provider: string, modelId: string) =>
        models.find((m) => m.provider === provider && m.id === modelId),
      getApiKeyAndHeaders: async () => auth,
    },
  } as unknown as ExtensionContext;
}

/** Isolated agent dir + cwd so tests never read or write the real ~/.pi. */
export function makeSettingsSandbox(section?: Record<string, unknown>): { agentDir: string; cwd: string } {
  const root = mkdtempSync(join(tmpdir(), "pi-vision-test-"));
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  if (section) {
    writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ "pi-vision": section }));
  }
  process.env.PI_CODING_AGENT_DIR = agentDir;
  return { agentDir, cwd };
}

export interface FakePi {
  api: ExtensionAPI;
  tools: Map<string, ToolDefinition<any, any, any>>;
  commands: Map<string, { description?: string; handler: (args: string, ctx: any) => unknown }>;
  handlers: Map<string, Array<(event: any, ctx: any) => any>>;
  activeTools: Set<string>;
}

export function makePi(): FakePi {
  const tools = new Map<string, ToolDefinition<any, any, any>>();
  const commands = new Map<string, { description?: string; handler: (args: string, ctx: any) => unknown }>();
  const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
  const activeTools = new Set(["image_ask", "read"]);
  const api = {
    registerTool: (definition: ToolDefinition<any, any, any>) => {
      tools.set(definition.name, definition);
    },
    registerCommand: (name: string, command: { description?: string; handler: (args: string, ctx: any) => unknown }) => {
      commands.set(name, command);
    },
    getActiveTools: () => [...activeTools],
    setActiveTools: (names: string[]) => {
      activeTools.clear();
      for (const name of names) activeTools.add(name);
    },
    on: (event: string, handler: (e: any, c: any) => any) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
  } as unknown as ExtensionAPI;
  return { api, tools, commands, handlers, activeTools };
}

export interface FakeUi {
  notifications: Array<{ message: string; type?: string }>;
  selected?: string;
  selectTitle?: string;
  selectOptions?: string[];
}

/** ExtensionCommandContext stub: records notifications, returns a scripted selection. */
export function makeCommandCtx(
  base: ExtensionContext,
  choose: (options: string[]) => string | undefined,
): { ctx: ExtensionCommandContext; ui: FakeUi } {
  const ui: FakeUi = { notifications: [] };
  const ctx = {
    ...base,
    hasUI: true,
    ui: {
      select: async (title: string, options: string[]) => {
        ui.selectTitle = title;
        ui.selectOptions = options;
        ui.selected = choose(options);
        return ui.selected;
      },
      notify: (message: string, type?: string) => {
        ui.notifications.push({ message, type });
      },
    },
  } as unknown as ExtensionCommandContext;
  return { ctx, ui };
}
