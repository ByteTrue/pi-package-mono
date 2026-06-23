export type PatchFrontmatterOptions = {
	/** `undefined` removes the key. */
	value: string | undefined;
};

const FRONTMATTER_END = /^---[ \t]*\r?$/m;

export function patchFrontmatterField(markdown: string, key: "model" | "thinking", options: PatchFrontmatterOptions): string {
	const parsed = splitFrontmatter(markdown);
	const line = options.value === undefined ? undefined : `${key}: ${formatScalar(options.value)}`;

	if (!parsed) {
		return line === undefined ? markdown : `---\n${line}\n---\n\n${markdown}`;
	}

	const lines = parsed.frontmatter.split(parsed.newline);
	let found = false;
	const nextLines: string[] = [];
	for (const current of lines) {
		if (isKeyLine(current, key)) {
			found = true;
			if (line !== undefined) nextLines.push(line);
		} else {
			nextLines.push(current);
		}
	}
	if (!found && line !== undefined) nextLines.push(line);

	const separator = parsed.afterFence.startsWith(parsed.newline) ? "" : parsed.newline;
	return `---${parsed.newline}${nextLines.join(parsed.newline)}${parsed.newline}---${separator}${parsed.afterFence}`;
}

function splitFrontmatter(markdown: string): { frontmatter: string; afterFence: string; newline: "\n" | "\r\n" } | undefined {
	if (!markdown.startsWith("---\n") && !markdown.startsWith("---\r\n")) return undefined;
	const newline: "\n" | "\r\n" = markdown.startsWith("---\r\n") ? "\r\n" : "\n";
	const start = 3 + newline.length;
	const rest = markdown.slice(start);
	const match = FRONTMATTER_END.exec(rest);
	if (!match || match.index === 0) return undefined;
	const frontmatter = rest.slice(0, match.index).replace(/\r?\n$/, "");
	const afterFence = rest.slice(match.index + match[0].length);
	return { frontmatter, afterFence, newline };
}

function isKeyLine(line: string, key: string): boolean {
	return new RegExp(`^${key}\\s*:`).test(line);
}

function formatScalar(value: string): string {
	return /^[A-Za-z0-9_./:@+-]+$/.test(value) ? value : JSON.stringify(value);
}
