import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findDownloadedChromeForTesting } from "./runtime.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pi-browser-runtime-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function touch(path: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "");
}

describe("Chrome for Testing discovery", () => {
  it("finds the newest agent-browser download on Windows", () => {
    const old = join(root, "chrome-140.0.7000.1", "chrome-win64", "chrome.exe");
    const current = join(root, "chrome-149.0.7777.10", "chrome-win64", "chrome.exe");
    touch(old);
    touch(current);
    expect(findDownloadedChromeForTesting(root, "win32")).toBe(current);
  });

  it("recognises macOS and Linux layouts and ignores unrelated files", () => {
    const mac = join(root, "chrome-149.0.1.0", "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing");
    touch(mac);
    touch(join(root, "chrome-200.0.0.0", "other", "not-chrome"));
    expect(findDownloadedChromeForTesting(root, "darwin")).toBe(mac);

    const linuxRoot = join(root, "linux");
    const linux = join(linuxRoot, "chrome-150.0.0.0", "chrome-linux64", "chrome");
    touch(linux);
    expect(findDownloadedChromeForTesting(linuxRoot, "linux")).toBe(linux);
  });

  it("returns undefined when the browser has not been installed", () => {
    expect(findDownloadedChromeForTesting(join(root, "missing"), "win32")).toBeUndefined();
  });
});
