// Config value resolver: Pi-style template, env ref, and !command resolution.
// Implements the exact Pi parser semantics described in the design:
// - Raw value not trimmed; only byte 0 '!' is a command
// - $VAR (greedy alphanumeric+underscore), ${VAR}, $$ → $, $!
// - Malformed/unclosed ref as literal
// - providerEnv truthy first, then process.env truthy, empty/missing → unresolved
// - Command uncached; preflight all paths before any execution

import { execFile } from "node:child_process";

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

type TemplateResult = {
	resolved: string;
	unresolved: boolean;
};

/**
 * Resolve Pi-style template references in a value.
 * - $VAR or ${VAR}: resolved via providerEnv (truthy) first, then process.env (truthy)
 * - $$: literal $
 * - $!: literal $!
 * - Malformed/unclosed: literal
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

		// $! → literal $!
		if (next === "!") {
			result += "$!";
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
			const resolved = resolveEnv(varName, providerEnv, processEnv);
			if (resolved !== undefined) {
				result += resolved;
			} else {
				unresolved = true;
			}
			i = close + 1;
			continue;
		}

		// $VAR form (greedy: alphanumeric + underscore)
		let j = i + 1;
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

export function createProductionCommandRunner(
	shellCmd: string = process.execPath,
): CommandRunner {
	return (commandBody: string, options: {
		signal: AbortSignal;
		timeoutMs: number;
		maxStdoutBytes: number;
	}): Promise<string> => {
		return new Promise<string>((resolve, reject) => {
			const child = execFile(shellCmd, ["-e", commandBody], {
				timeout: options.timeoutMs,
				signal: options.signal,
				maxBuffer: options.maxStdoutBytes,
				encoding: "utf-8",
			});

			let stdout = "";
			child.stdout?.on("data", (chunk: string) => {
				stdout += chunk;
				if (Buffer.byteLength(stdout, "utf-8") > options.maxStdoutBytes) {
					child.kill();
					reject(new Error("Command output exceeded maximum size"));
				}
			});

			child.on("error", (err: NodeJS.ErrnoException) => {
				if (err.name === "AbortError" || err.code === "ABORT_ERR") {
					reject(new Error("Command aborted"));
				} else {
					reject(new Error("Command execution failed"));
				}
			});

			child.on("close", (code) => {
				if (code === 0) {
					resolve(stdout.replace(/\r?\n$/, ""));
				} else if (code !== null) {
					reject(new Error("Command execution failed"));
				}
				// If code is null (killed by signal), it was already handled in 'error'
			});
		});
	};
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
			return { kind: "resolved", value: output, source: "command" };
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
