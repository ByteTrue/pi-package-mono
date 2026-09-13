import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerPiBrowser from "./index.js";

describe("pi-browser extension entry", () => {
  it("registers the /browser command and the startup notice", () => {
    const registerCommand = vi.fn((_name: string, _options: unknown) => undefined);
    const on = vi.fn((_event: string, _handler: unknown) => undefined);
    const pi = { registerCommand, on, exec: vi.fn() } as unknown as ExtensionAPI;

    registerPiBrowser(pi);

    expect(registerCommand).toHaveBeenCalledTimes(1);
    const call = registerCommand.mock.calls[0];
    expect(call?.[0]).toBe("browser");
    const options = call?.[1] as { handler?: unknown } | undefined;
    expect(typeof options?.handler).toBe("function");

    expect(on).toHaveBeenCalledTimes(1);
    expect(on.mock.calls[0]?.[0]).toBe("session_start");
    expect(typeof on.mock.calls[0]?.[1]).toBe("function");
  });
});
