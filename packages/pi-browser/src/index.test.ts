import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerPiBrowser from "./index.js";

describe("pi-browser extension entry", () => {
  it("registers only the /browser command plus a startup leftover-session notice", () => {
    const registerCommand = vi.fn();
    const on = vi.fn();
    const pi = { registerCommand, on, exec: vi.fn() } as unknown as ExtensionAPI;

    registerPiBrowser(pi);

    expect(registerCommand).toHaveBeenCalledTimes(1);
    expect(registerCommand.mock.calls[0]?.[0]).toBe("browser");
    expect(typeof registerCommand.mock.calls[0]?.[1]?.handler).toBe("function");
    expect(on).toHaveBeenCalledTimes(1);
    expect(on.mock.calls[0]?.[0]).toBe("session_start");
    expect(typeof on.mock.calls[0]?.[1]).toBe("function");
  });
});
