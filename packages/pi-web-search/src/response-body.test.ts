import { describe, expect, it } from "vitest";
import { readResponseJson, readResponseText } from "./response-body.js";

const encoder = new TextEncoder();

describe("readResponseText", () => {
	it("decodes UTF-8 split across stream chunks", async () => {
		const bytes = encoder.encode("A🙂B");
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(bytes.slice(0, 3));
				controller.enqueue(bytes.slice(3));
				controller.close();
			},
		});

		await expect(readResponseText(new Response(body), 32)).resolves.toBe("A🙂B");
	});

	it("coalesces many tiny and empty chunks without changing content", async () => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array());
				for (const byte of encoder.encode("tiny chunks")) controller.enqueue(Uint8Array.of(byte));
				controller.close();
			},
		});

		await expect(readResponseText(new Response(body), 32)).resolves.toBe("tiny chunks");
	});

	it("rejects Content-Length over budget before reading and cancels the body", async () => {
		let cancelled = false;
		const body = new ReadableStream<Uint8Array>({
			cancel() {
				cancelled = true;
			},
		});
		const response = new Response(body, { headers: { "content-length": "11" } });

		await expect(readResponseText(response, 10)).rejects.toThrow(/exceeds the 10-byte limit/);
		expect(cancelled).toBe(true);
	});

	it("does not pre-reject compressed responses using transfer Content-Length", async () => {
		const response = new Response("1234567890", {
			headers: { "content-encoding": "gzip", "content-length": "11" },
		});

		await expect(readResponseText(response, 10)).resolves.toBe("1234567890");
	});

	it("counts streamed bytes when Content-Length is absent and cancels on overflow", async () => {
		let pull = 0;
		let cancelled = false;
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				controller.enqueue(encoder.encode(pull++ === 0 ? "123456" : "78901"));
			},
			cancel() {
				cancelled = true;
			},
		});

		await expect(readResponseText(new Response(body), 10)).rejects.toThrow(/exceeds the 10-byte limit/);
		expect(cancelled).toBe(true);
	});

	it("accepts a body exactly at the byte budget", async () => {
		await expect(readResponseText(new Response("1234567890"), 10)).resolves.toBe("1234567890");
	});
});

describe("readResponseJson", () => {
	it("parses JSON through the same bounded reader", async () => {
		await expect(readResponseJson<{ ok: boolean }>(new Response('{"ok":true}'), 32)).resolves.toEqual({ ok: true });
	});
});
