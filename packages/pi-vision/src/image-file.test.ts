import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, readImageFile, sniffMime } from "./image-file.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const GIF = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("WEBP"),
  Buffer.from([0]),
]);
// Same RIFF header as WebP but a WAVE payload — must not be accepted as an image.
const WAVE = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WAVE")]);

function sandbox(): string {
  return mkdtempSync(join(tmpdir(), "pi-vision-img-"));
}

describe("sniffMime", () => {
  it("recognises the four supported formats", () => {
    expect(sniffMime(PNG)).toBe("image/png");
    expect(sniffMime(JPEG)).toBe("image/jpeg");
    expect(sniffMime(GIF)).toBe("image/gif");
    expect(sniffMime(WEBP)).toBe("image/webp");
  });

  it("rejects a RIFF container that is not WebP", () => {
    expect(sniffMime(WAVE)).toBeUndefined();
  });

  it("rejects text", () => {
    expect(sniffMime(Buffer.from("not an image at all"))).toBeUndefined();
  });
});

describe("readImageFile", () => {
  it("reads an absolute path into base64 ImageContent", async () => {
    const dir = sandbox();
    const file = join(dir, "shot.png");
    writeFileSync(file, PNG);

    const content = await readImageFile(file, "/nowhere");

    expect(content).toEqual({
      type: "image",
      data: PNG.toString("base64"),
      mimeType: "image/png",
    });
  });

  it("resolves a relative path against cwd", async () => {
    const dir = sandbox();
    writeFileSync(join(dir, "shot.jpg"), JPEG);

    const content = await readImageFile("shot.jpg", dir);

    expect(content.mimeType).toBe("image/jpeg");
  });

  it("trusts the file header, not the extension", async () => {
    const dir = sandbox();
    const file = join(dir, "actually-a-png.jpg");
    writeFileSync(file, PNG);

    expect((await readImageFile(file, dir)).mimeType).toBe("image/png");
  });

  it("rejects a non-image file by name", async () => {
    const dir = sandbox();
    const file = join(dir, "notes.txt");
    writeFileSync(file, "hello");

    await expect(readImageFile(file, dir)).rejects.toThrow(/not a PNG, JPEG, GIF or WebP/);
  });

  it("reports a missing file with its resolved path", async () => {
    const dir = sandbox();

    await expect(readImageFile("missing.png", dir)).rejects.toThrow(join(dir, "missing.png"));
  });

  it("rejects a directory", async () => {
    const dir = sandbox();

    await expect(readImageFile(dir, dir)).rejects.toThrow(/not a file/);
  });

  it("rejects URLs with a hint to download first", async () => {
    await expect(readImageFile("https://example.com/a.png", "/tmp")).rejects.toThrow(
      /local file paths, not URLs/,
    );
  });

  it("rejects an empty path", async () => {
    await expect(readImageFile("   ", "/tmp")).rejects.toThrow(/Empty image path/);
  });

  it("rejects a file over the size limit before reading it", async () => {
    const dir = sandbox();
    const file = join(dir, "huge.png");
    writeFileSync(file, Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES)]));

    await expect(readImageFile(file, dir)).rejects.toThrow(/over the 20MB limit/);
  });
});
