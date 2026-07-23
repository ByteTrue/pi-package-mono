import { DEFAULT_MAX_BUFFER_SIZE } from "../constants.js";

export interface SearchMatch {
  lineNumber: number;
  text: string;
}

export class RingBuffer {
  private buffer = "";

  constructor(private readonly maxSize: number = DEFAULT_MAX_BUFFER_SIZE) {}

  append(data: string): void {
    this.buffer += data;
    if (this.buffer.length > this.maxSize) {
      this.buffer = this.buffer.slice(-this.maxSize);
    }
  }

  read(offset = 0, limit?: number): string[] {
    if (this.buffer === "") return [];
    const lines = this.splitBufferLines();
    const start = Math.max(0, offset);
    const end = limit !== undefined ? start + limit : lines.length;
    return lines.slice(start, end);
  }

  readRaw(): string {
    return this.buffer;
  }

  search(pattern: RegExp): SearchMatch[] {
    const matches: SearchMatch[] = [];
    const lines = this.splitBufferLines();
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (line && pattern.test(line)) {
        matches.push({ lineNumber: index + 1, text: line });
      }
    }
    return matches;
  }

  flush(): void {
    // Keep parity with opencode-pty: no-op.
  }

  clear(): void {
    this.buffer = "";
  }

  get length(): number {
    if (this.buffer === "") return 0;
    return this.splitBufferLines().length;
  }

  get byteLength(): number {
    return Buffer.byteLength(this.buffer, "utf8");
  }

  private splitBufferLines(): string[] {
    const lines = this.buffer.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }
    return lines;
  }
}
