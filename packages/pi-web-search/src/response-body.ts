export const MAX_RESPONSE_BODY_BYTES = 10 * 1024 * 1024;
export const MAX_SEARCH_RESPONSE_BODY_BYTES = 2 * 1024 * 1024;

function overBudget(limit: number): Error {
	return new Error(`Response body exceeds the ${limit}-byte limit`);
}

// Known TextDecoder labels worth accepting; anything else falls back to UTF-8.
// GBK/GB18030 matter most here: the package's core providers serve mainland
// Chinese pages where legacy charsets are still common (audit BYTE-4 #12).
const DECODER_LABELS = new Set(["utf-8", "utf8", "gbk", "gb2312", "gb18030", "big5", "shift_jis", "shift-jis", "euc-jp", "euc-kr", "iso-8859-1", "latin1", "windows-1252", "windows-1251", "koi8-r", "us-ascii"]);

// Decode the body using the response charset instead of assuming UTF-8. The
// contentTypeHeader is parsed for its charset parameter; unknown or missing
// charsets degrade to UTF-8 (replacement chars, never a throw).
export function charsetFromContentType(contentTypeHeader: string | undefined | null): string {
	const charset = contentTypeHeader
		?.split(";")
		.map((part) => part.trim())
		.find((part) => part.toLowerCase().startsWith("charset="))
		?.slice("charset=".length)
		.trim()
		.replace(/^"|"$/g, "")
		.toLowerCase();
	return charset && DECODER_LABELS.has(charset) ? charset : "utf-8";
}

export async function readResponseText(
	response: Pick<Response, "body" | "headers">,
	maxBytes: number = MAX_RESPONSE_BODY_BYTES,
	charsetOverride?: string,
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
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > maxBytes) {
				await reader.cancel().catch(() => {});
				throw overBudget(maxBytes);
			}
			chunks.push(value);
		}
		const charset = charsetOverride ?? charsetFromContentType(response.headers.get("content-type"));
		let decoder: TextDecoder;
		try {
			decoder = new TextDecoder(charset);
		} catch {
			decoder = new TextDecoder("utf-8");
		}
		return decoder.decode(Buffer.concat(chunks, bytes));
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
