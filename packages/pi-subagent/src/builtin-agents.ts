import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface AgentConfig {
  model?: string;
  thinking?: string;
  tools?: string[];
  systemPrompt?: string;
}

/**
 * Built-in roles ship as ordinary agent documents in `agents/` next to this
 * module, so a built-in role and a user's `.pi/agents/*.md` are the same kind
 * of file parsed by the same code. Copy one out to customise it; a user file
 * with the same name wins.
 */
export const BUILTIN_AGENTS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "agents",
);

export function listBuiltinAgentNames(): string[] {
  try {
    return readdirSync(BUILTIN_AGENTS_DIR)
      .filter((name) => name.endsWith(".md") && !name.startsWith("."))
      .map((name) => name.slice(0, -3));
  } catch {
    return [];
  }
}
