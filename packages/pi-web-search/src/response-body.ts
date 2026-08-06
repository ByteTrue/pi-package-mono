export const MAX_RESPONSE_BODY_BYTES = 10 * 1024 * 1024;
export const MAX_SEARCH_RESPONSE_BODY_BYTES = 2 * 1024 * 1024;

function overBudget(limit: number): Error {
	return new Error(`Response body exceeds the ${limit}-byte limit`);
}

export async function readResponseText(
	response: Pick<Response, "body" | "headers">,
	maxBytes: number = MAX_RESPONSE_BODY_BYTES,
): Promise<string> {
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError("maxBytes must be a non-negative safe integer");
	const declared = Number(response.headers.get("content-length"));
	const contentEncoding = response.headers.get("content-encoding")?.trim().toLowerCase();
	if ((!contentEncoding || contentEncoding === "identity") && Number.isFinite(declared) && declared > maxBytes) {
		await response.body?.cancel().catch(() => {});
		throw overBudget(maxBytes);
	}
	if (!response.body) return "";

	const reader = response.body.getReader();
	let buffer = new Uint8Array(Math.min(maxBytes, 64 * 1024));
	let bytes = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			const nextBytes = bytes + value.byteLength;
			if (nextBytes > maxBytes) {
				await reader.cancel().catch(() => {});
				throw overBudget(maxBytes);
			}
			if (nextBytes > buffer.byteLength) {
				const grown = new Uint8Array(Math.min(maxBytes, Math.max(nextBytes, buffer.byteLength * 2)));
				grown.set(buffer.subarray(0, bytes));
				buffer = grown;
			}
			buffer.set(value, bytes);
			bytes = nextBytes;
		}
		return new TextDecoder().decode(buffer.subarray(0, bytes));
	} finally {
		reader.releaseLock();
}
}

export async function readResponseJson<T>(
	response: Pick<Response, "body" | "headers">,
	maxBytes: number = MAX_RESPONSE_BODY_BYTES,
): Promise<T> {
	const text = await readResponseText(response, maxBytes);
	try {
		return JSON.parse(text) as T;
	} catch {
		throw new Error("Response body is not valid JSON");
	}
}
