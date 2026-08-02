import { describe, expect, it } from "vitest";
import registerVision, { NON_VISION_MARKER } from "./index.js";
import { makePi } from "./test-helpers.js";

/** Shape pi's read tool returns for an image when the current model cannot see images. */
function readImageResult(note: string) {
  return {
    toolName: "read",
    input: { path: "/tmp/pi-clipboard-abc.png" },
    content: [
      { type: "text" as const, text: `Read image file [image/png]\n${note}` },
      { type: "image" as const, data: "AAA", mimeType: "image/png" },
    ],
  };
}

function fire(handlers: Map<string, Array<(e: any, c: any) => any>>, event: unknown) {
  const handler = handlers.get("tool_result")?.[0];
  if (!handler) throw new Error("no tool_result handler registered");
  return handler(event, {});
}

describe("registerVision", () => {
  it("registers exactly one tool, one command and one hook", () => {
    const pi = makePi();

    registerVision(pi.api);

    expect([...pi.tools.keys()]).toEqual(["image_ask"]);
    expect([...pi.commands.keys()]).toEqual(["vision"]);
    expect([...pi.handlers.keys()]).toEqual(["tool_result"]);
  });

  it("points a dropped-image read at image_ask, keeping the original text and image part", () => {
    const pi = makePi();
    registerVision(pi.api);
    const event = readImageResult(
      "[Current model does not support images. The image will be omitted from this request.]",
    );

    const patch = fire(pi.handlers, event);

    expect(patch.content).toHaveLength(2);
    expect(patch.content[0].text).toContain("Read image file [image/png]");
    expect(patch.content[0].text).toContain("image_ask");
    expect(patch.content[0].text).toContain("/tmp/pi-clipboard-abc.png");
    // The image part is pi's business, not ours.
    expect(patch.content[1]).toBe(event.content[1]!);
    // Never mutate the event in place.
    expect(event.content[0]!.text).not.toContain("image_ask");
  });

  it("stays out of the way when the model can see images", () => {
    const pi = makePi();
    registerVision(pi.api);

    const patch = fire(pi.handlers, {
      toolName: "read",
      input: { path: "/tmp/a.png" },
      content: [{ type: "text", text: "Read image file [image/png]" }],
    });

    expect(patch).toBeUndefined();
  });

  it("ignores other tools", () => {
    const pi = makePi();
    registerVision(pi.api);

    const patch = fire(pi.handlers, {
      toolName: "bash",
      input: { command: "echo hi" },
      content: [{ type: "text", text: `something ${NON_VISION_MARKER} something` }],
    });

    expect(patch).toBeUndefined();
  });

  it("does not fire on an ordinary text file that merely quotes pi's error string", () => {
    // Real bug caught while writing this package's own docs: reading a markdown file that
    // quotes pi's non-vision note verbatim must not be mistaken for a dropped image.
    const pi = makePi();
    registerVision(pi.api);

    const patch = fire(pi.handlers, {
      toolName: "read",
      input: { path: "/tmp/notes.md" },
      content: [
        {
          type: "text",
          text: `Evidence: pi prints "[Current model ${NON_VISION_MARKER}. The image will be omitted from this request.]" when it drops an image.`,
        },
      ],
    });

    expect(patch).toBeUndefined();
  });

  it("falls back to a placeholder path when read's input is unusable", () => {
    const pi = makePi();
    registerVision(pi.api);

    const patch = fire(pi.handlers, {
      toolName: "read",
      input: undefined,
      content: [{ type: "text", text: `Read image file [image/png]\nx ${NON_VISION_MARKER} y` }],
    });

    expect(patch.content[0].text).toContain("path/to/image.png");
  });
});
