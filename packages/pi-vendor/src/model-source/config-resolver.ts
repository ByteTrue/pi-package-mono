// Config value resolver: Pi-style template, env ref, and !command resolution.
// Implements the exact Pi parser semantics described in the design:
// - Raw value not trimmed; only byte 0 '!' is a command
// - $VAR (greedy alphanumeric+underscore), ${VAR}, $$ → $, $!
// - Malformed/unclosed ref as literal
// - providerEnv truthy first, then process.env truthy, empty/missing → unresolved
// - Command uncached; preflight all paths before any execution

import { spawn } from "node:child_process";

export type CredentialPath =
	| { kind: "apiKey" }
	| { kind: "header"; name: string };

export type CommandRunner = (
	commandBody: string,
	options: { signal: AbortSignal; timeoutMs: number; maxStdoutBytes: number },
) => Promise<string>;

export type ConfigValueResolver = (
	value: string,
	context: {
		path: CredentialPath;
		initialValue?: string;
		providerEnv: Record<string, string | undefined>;
		processEnv: Record<string, string | undefined>;
		signal: AbortSignal;
		runCommand: CommandRunner;
	},
) => Promise<string>;

export type ResolveResult =
	| { kind: "resolved"; value: string; source: "literal" | "env" | "command" }
	| { kind: "unresolved"; reason: string };

// --- Template parser ---

/** Encode a literal so Pi will not interpret leading ! or $ references. */
export function encodeConfigLiteral(value: string): string {
	const dollarsEscaped = value.replaceAll("$", () => "$$");
	return dollarsEscaped.startsWith("!") ? `$${dollarsEscaped}` : dollarsEscaped;
}

type TemplateResult = {
	resolved: string;
	unresolved: boolean;
};

/**
 * Resolve Pi-style template references in a value.
 * - $VAR or ${VAR}: resolved via providerEnv (truthy) first, then process.env (truthy)
 * - $$: literal $
 * - $!: literal !
 * - Invalid/unclosed references remain literal
 * - Whitespace in literal text is preserved
 */
function resolveTemplate(
	value: string,
	providerEnv: Record<string, string | undefined>,
	processEnv: Record<string, string | undefined>,
): TemplateResult {
	let result = "";
	let unresolved = false;
	let i = 0;

	while (i < value.length) {
		if (value[i] !== "$" || i + 1 >= value.length) {
			result += value[i];
			i++;
			continue;
		}

		// peek at next char
		const next = value[i + 1]!;

		// $$ → literal $
		if (next === "$") {
			result += "$";
			i += 2;
			continue;
		}

		// $! → literal !
		if (next === "!") {
			result += "!";
			i += 2;
			continue;
		}

		// ${VAR} form
		if (next === "{") {
			const close = value.indexOf("}", i + 2);
			if (close === -1) {
				// unclosed — literal
				result += value[i];
				i++;
				continue;
			}
			const varName = value.slice(i + 2, close);
			if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(varName)) {
				result += value.slice(i, close + 1);
				i = close + 1;
				continue;
			}
			const resolved = resolveEnv(varName, providerEnv, processEnv);
			if (resolved !== undefined) {
				result += resolved;
			} else {
				unresolved = true;
			}
			i = close + 1;
			continue;
		}

		// $VAR form (must start with a letter or underscore)
		if (!/[a-zA-Z_]/.test(next)) {
			result += "$";
			i++;
			continue;
		}
		let j = i + 2;
		while (j < value.length && /[a-zA-Z0-9_]/.test(value[j]!)) {
			j++;
		}
		const varName = value.slice(i + 1, j);
		const resolved = resolveEnv(varName, providerEnv, processEnv);
		if (resolved !== undefined) {
			result += resolved;
		} else {
			unresolved = true;
		}
		i = j;
	}

	return { resolved: result, unresolved };
}

function resolveEnv(
	name: string,
	providerEnv: Record<string, string | undefined>,
	processEnv: Record<string, string | undefined>,
): string | undefined {
	// provider env truthy values first
	const pv = providerEnv[name];
	if (pv !== undefined && pv !== "") return pv;
	// then process.env truthy values
	const ev = processEnv[name];
	if (ev !== undefined && ev !== "") return ev;
	return undefined;
}

// --- Command detection ---

function isCommand(value: string): boolean {
	return value.length > 0 && value.charCodeAt(0) === 33; // '!'
}

function commandBody(value: string): string {
	return value.slice(1);
}

// --- Production command runner ---

export function createProductionCommandRunner(): CommandRunner {
	return (commandBody, options) => new Promise<string>((resolve, reject) => {
		const shell = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "/bin/sh";
		const args = process.platform === "win32"
			? ["/d", "/s", "/c", commandBody]
			: ["-c", commandBody];
		let settled = false;
		let stdoutBytes = 0;
		const chunks: Buffer[] = [];
		let child: ReturnType<typeof spawn>;

		const finish = (error?: Error, value?: string): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (error) reject(error);
			else resolve(value ?? "");
		};

		try {
			child = spawn(shell, args, {
				stdio: ["ignore", "pipe", "ignore"],
				windowsHide: true,
				signal: options.signal,
			});
		} catch {
			reject(new Error("Command execution failed"));
			return;
		}

		const timer = setTimeout(() => {
			child.kill();
			finish(new Error("Command timed out"));
		}, options.timeoutMs);
		timer.unref?.();

		child.stdout!.on("data", (chunk: Buffer | string) => {
			const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			stdoutBytes += buffer.length;
			if (stdoutBytes > options.maxStdoutBytes) {
				child.kill();
				finish(new Error("Command output exceeded maximum size"));
				return;
			}
			chunks.push(buffer);
		});
		child.on("error", () => finish(new Error(options.signal.aborted ? "Command aborted" : "Command execution failed")));
		child.on("close", (code) => {
			if (settled) return;
			if (options.signal.aborted) return finish(new Error("Command aborted"));
			if (code !== 0) return finish(new Error("Command execution failed"));
			finish(undefined, Buffer.concat(chunks).toString("utf8").trim());
		});
	});
}

// --- Main resolver ---

export async function resolveConfigValue(
	value: string,
	context: {
		path: CredentialPath;
		initialValue?: string;
		providerEnv: Record<string, string | undefined>;
		processEnv: Record<string, string | undefined>;
		signal: AbortSignal;
		runCommand: CommandRunner;
	},
): Promise<ResolveResult> {
	if (isCommand(value)) {
		// !command — run it (preflight already validated trust)
		try {
			const output = await context.runCommand(commandBody(value), {
				signal: context.signal,
				timeoutMs: 10_000,
				maxStdoutBytes: 64 * 1024,
			});
			return output === ""
				? { kind: "unresolved", reason: "Command execution failed" }
				: { kind: "resolved", value: output, source: "command" };
		} catch (err) {
			return { kind: "unresolved", reason: "Command execution failed" };
		}
	}

	// Template resolution
	const tmpl = resolveTemplate(value, context.providerEnv, context.processEnv);
	if (tmpl.unresolved) {
		return { kind: "unresolved", reason: "Environment variable not set" };
	}

	// If after template resolution the value is empty, check for literal
	if (tmpl.resolved === "") {
		return { kind: "resolved", value: "", source: "literal" };
	}

	return { kind: "resolved", value: tmpl.resolved, source: "env" };
}

// --- Command trust preflight ---

export type CommandTrustPath = {
	path: CredentialPath;
	rawValue: string;
};

/**
 * Collect all command-bearing paths from a provider config.
 * Fixed surfaces: apiKey + each exact header name.
 */
export function collectCommandPaths(
	provider: { apiKey?: string; headers?: Record<string, string> },
): CommandTrustPath[] {
	const paths: CommandTrustPath[] = [];

	if (provider.apiKey !== undefined && isCommand(provider.apiKey)) {
		paths.push({ path: { kind: "apiKey" }, rawValue: provider.apiKey });
	}

	if (provider.headers) {
		for (const [name, value] of Object.entries(provider.headers)) {
			if (isCommand(value)) {
				paths.push({ path: { kind: "header", name }, rawValue: value });
			}
		}
	}

	return paths;
}

/**
 * Verify that all command-bearing paths in the current provider match
 * the initial (trusted) provider snapshot.
 *
 * A path is trusted only if:
 * - It exists in the initial provider with the exact same structured path
 * - The raw value is identical (byte-exact match)
 *
 * Returns the list of trusted paths.
 */
export function preflightCommandTrust(
	currentProvider: { apiKey?: string; headers?: Record<string, string> },
	initialProvider: { apiKey?: string; headers?: Record<string, string> },
): CommandTrustPath[] {
	const current = collectCommandPaths(currentProvider);
	if (current.length === 0) return [];

	const trusted: CommandTrustPath[] = [];

	for (const cp of current) {
		if (cp.path.kind === "apiKey") {
			if (initialProvider.apiKey === cp.rawValue) {
				trusted.push(cp);
			}
		} else {
			const initialHeaders = initialProvider.headers ?? {};
			if (initialHeaders[cp.path.name] === cp.rawValue) {
				trusted.push(cp);
			}
		}
	}

	return trusted;
}

/**
 * Check if all command paths are trusted.
 * If ANY path is not trusted, returns false (fail-closed).
 */
export function allCommandsTrusted(
	currentProvider: { apiKey?: string; headers?: Record<string, string> },
	initialProvider: { apiKey?: string; headers?: Record<string, string> },
): boolean {
	const current = collectCommandPaths(currentProvider);
	if (current.length === 0) return true;

	const trusted = preflightCommandTrust(currentProvider, initialProvider);
	return trusted.length === current.length;
}
