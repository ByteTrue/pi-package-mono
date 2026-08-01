import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface RegisteredTool {
  name: string;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
    onUpdate: () => void,
    ctx: unknown,
  ) => Promise<{ content: Array<{ type: string; text: string }>; details?: unknown }>;
}

/** Registers one tool through a minimal ExtensionAPI double and returns it. */
export function registerOne(register: (pi: ExtensionAPI) => void): RegisteredTool {
  const tools: RegisteredTool[] = [];
  const pi = {
    registerTool(tool: RegisteredTool) {
      tools.push(tool);
    },
  } as unknown as ExtensionAPI;
  register(pi);
  const tool = tools[0];
  if (!tool) throw new Error("no tool was registered");
  return tool;
}

export function call(
  tool: RegisteredTool,
  params: Record<string, unknown>,
  sessionId: string,
): ReturnType<RegisteredTool["execute"]> {
  return tool.execute("call", params, new AbortController().signal, () => {}, {
    cwd: process.cwd(),
    sessionManager: { getSessionId: () => sessionId },
  });
}
