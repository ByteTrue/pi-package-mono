import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import registerBashTimeout from "./index.js";

describe("pi-bash-timeout extension", () => {
  // The package's whole contract: nothing registered, two hooks only. A setup whose
  // architecture checks reject foreground-timeout hook source relies on this package
  // being physically absent from the install — and on it registering no tools if present.
  it("registers no tools and no commands; subscribes only to tool_call and tool_result", () => {
    const toolNames: string[] = [];
    const commandNames: string[] = [];
    const events: string[] = [];
    const pi = {
      registerTool(tool: { name: string }) {
        toolNames.push(tool.name);
      },
      registerCommand(name: string) {
        commandNames.push(name);
      },
      on(event: string) {
        events.push(event);
      },
    } as unknown as ExtensionAPI;

    registerBashTimeout(pi);

    expect(toolNames).toEqual([]);
    expect(commandNames).toEqual([]);
    expect(events.sort()).toEqual(["tool_call", "tool_result"]);
    expect(toolNames).not.toContain("bash");
    expect(toolNames).not.toContain("powershell");
  });
});
