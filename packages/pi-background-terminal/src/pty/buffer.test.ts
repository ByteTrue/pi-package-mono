import { describe, expect, it } from "vitest";
import { RingBuffer } from "./buffer.js";

describe("RingBuffer", () => {
  it("reads appended lines and searches by regex", () => {
    const buffer = new RingBuffer(10_000);
    buffer.append("alpha\nbeta\ngamma\n");

    expect(buffer.read()).toEqual(["alpha", "beta", "gamma"]);
    expect(buffer.search(/a/)).toEqual([
      { lineNumber: 1, text: "alpha" },
      { lineNumber: 2, text: "beta" },
      { lineNumber: 3, text: "gamma" },
    ]);
  });

  it("trims old content when max size is exceeded", () => {
    const buffer = new RingBuffer(12);
    buffer.append("first\nsecond\nthird\n");

    expect(buffer.readRaw()).toBe("econd\nthird\n");
    expect(buffer.read()).toEqual(["econd", "third"]);
  });
});
