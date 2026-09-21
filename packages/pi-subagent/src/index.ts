import { readdirSync, readFileSync, statSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { delimiter, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { StringDecoder } from "node:string_decoder";
import { homedir } from "node:os";
import { loadSubagentSettings, type SubagentSettings } from "./settings.js";
import { runSubagentCommand } from "./command.js";
import { BUILTIN_AGENTS_DIR, listBuiltinAgentNames, type AgentConfig } from "./builtin-agents.js";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export { BUILTIN_AGENTS_DIR, listBuiltinAgentNames, type AgentConfig };

// ── Types ──────────────────────────────────────────────────────────────
export type JsonObject = Record<string, unknown>;
export type TextContent = { type: "text"; text: string };

export interface PiToolResult {
  content: TextContent[];
  details?: unknown;
}

export interface PiExtensionContext {
  hasUI?: boolean;
  model?: {
    provider?: string;
    id?: string;
  };
  sessionManager?: {
    getSessionId?: () => string;
    getSessionFile?: () => string | undefined;
  };
  ui?: {
    notify?: (msg: string, type?: "info" | "warning" | "error") => void;
    setStatus?: (id: string, text?: string) => void;
  };
}

export interface SubagentTaskItem {
  task: string;
  agent?: string;
  tools?: string[];
  cwd?: string;
  resume?: string;
  id?: string;
  timeoutMs?: number;
  maxTurns?: number;
}

/** One call = one subagent (issue 095); parallelism = multiple tool calls in one message. */
export type SubagentInput = SubagentTaskItem;

export interface PiRunConfig {
  model?: string;
  thinking?: string;
  tools?: string[];
  cwd?: string;
  sessionId?: string;
  resumeSession?: string;
  timeoutMs?: number;
  maxTurns?: number;
}

// ── Lazy-load pi-tui with safe string truncation fallback ──────────────
const require = createRequire(import.meta.url);
let _piTui: {
  visibleWidth?: (s: string) => number;
  truncateToWidth?: (s: string, w: number, ellipsis?: string) => string;
} | null = null;

function getPiTui() {
  if (!_piTui) {
    try {
      _piTui = require("@earendil-works/pi-tui");
    } catch {
      _piTui = {};
    }
  }
  return _piTui;
}

function trunc(s: string, w: number) {
  const t = getPiTui();
  return t && t.truncateToWidth
    ? t.truncateToWidth(s, w, "…")
    : s.length <= w
      ? s
      : w > 1
        ? s.slice(0, w - 1) + "…"
        : s.slice(0, w);
}

// ── Constants ─────────────────────────────────────────────────────────
const MAX_STDOUT = 8 * 1024 * 1024;
const MAX_STDERR = 1024 * 1024;
const MAX_TAIL = 256 * 1024;
const MAX_LINE_BUFFER = 1024 * 1024;
const MAX_TOOL_ARG_CHARS = 2048;
const MAX_TOOLS = 256;
const ABORT_KILL_GRACE_MS = 1500;
const THROTTLE_MS = 300;
const MAX_FALLBACK_OUTPUT_CHARS = 8192;
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes
const DEFAULT_MAX_TURNS = 50; // 50 turns
let toolCallCounter = 0;

// ── State types ───────────────────────────────────────────────────────
export type RunStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled" | "paused";
export type ToolStatus = "running" | "succeeded" | "failed";

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  ctxTokens: number;
  turns: number;
}

export interface ToolTrace {
  id: string;
  name: string;
  args: string;
  status: ToolStatus;
  startedAt: number;
  finishedAt?: number;
}

export interface RunState {
  id: string;
  agent: string;
  prompt: string;
  sessionId: string;
  /** Child process cwd; with sessionId it locates the persisted session log. */
  cwd?: string;
  step?: number;
  status: RunStatus;
  pauseReason?: "timeout" | "max_turns";
  startedAt?: number;
  finishedAt?: number;
  finalText: string;
  textTail: string;
  thinkingTail: string;
  stderrTail: string;
  tools: ToolTrace[];
  usage: Usage;
  model?: string;
  thinking?: string;
  errorMessage?: string;
}

export interface ProgressDetails {
  kind: "pi-subagent-progress";
  agent: string;
  startedAt: number;
  updatedAt: number;
  final: boolean;
  runs: RunState[];
}

// ── Native card handle registry ───────────────────────────────────────
function totalUsage(d: ProgressDetails): Usage {
  const u: Usage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    ctxTokens: 0,
    turns: 0,
  };
  for (const r of d.runs) {
    u.input += r.usage.input;
    u.output += r.usage.output;
    u.cacheRead += r.usage.cacheRead;
    u.cacheWrite += r.usage.cacheWrite;
    u.cost += r.usage.cost;
    u.ctxTokens = Math.max(u.ctxTokens, r.usage.ctxTokens);
    u.turns += r.usage.turns;
  }
  return u;
}

function activeRun(d: ProgressDetails): RunState | undefined {
  return d.runs.find((r) => r.status === "running") ?? d.runs.at(-1);
}

function toolArgs(t: ToolTrace): Record<string, unknown> {
  try {
    return JSON.parse(t.args) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function bashCommand(t: ToolTrace): string {
  const a = toolArgs(t);
  return String(a.command || "").toLowerCase();
}

function isSearchTool(t: ToolTrace): boolean {
  return (
    t.name === "read" ||
    t.name === "grep" ||
    t.name === "find" ||
    t.name === "web_search" ||
    t.name === "web_fetch"
  );
}

function isMutationTool(t: ToolTrace): boolean {
  return t.name === "edit" || t.name === "write";
}

function isValidationCommand(t: ToolTrace): boolean {
  const c = bashCommand(t);
  return /\b(test|typecheck|lint|build|gofmt|go test|npm test|pnpm test|vitest|jest|tsc|cargo test|cargo check)\b/.test(
    c,
  );
}

function isInspectionCommand(t: ToolTrace): boolean {
  const c = bashCommand(t);
  return /\b(rg|grep|find|git diff|git status|ls|tree|cat)\b/.test(c);
}

function thinkingIntent(text: string): string {
  const s = text.toLowerCase();
  if (/error|failed|failure|panic|exception|报错|失败|错误|异常/.test(s))
    return "Analyzing failure cause";
  if (/test|verify|check|typecheck|lint|验证|测试|检查/.test(s))
    return "Planning verification steps";
  if (/plan|approach|design|strategy|方案|计划|思路|设计/.test(s))
    return "Structuring execution approach";
  if (/implement|change|edit|modify|refactor|实现|修改|重构/.test(s))
    return "Reasoning through code changes";
  if (/inspect|search|locate|read|context|定位|搜索|阅读|上下文/.test(s))
    return "Locating relevant context";
  return "";
}

function behaviorSummary(r: RunState): string {
  if (r.status === "succeeded") return "Task completed successfully";
  if (r.status === "paused") return `Task paused (${r.pauseReason === "timeout" ? "timeout" : "max turns reached"})`;
  if (r.status === "failed") return "Task failed with error";
  if (r.status === "cancelled") return "Task was cancelled";

  const runningTool = r.tools.findLast((t) => t.status === "running");
  if (runningTool) {
    if (isMutationTool(runningTool)) return "Modifying files";
    if (runningTool.name === "bash" && isValidationCommand(runningTool))
      return "Running tests and checks";
    if (runningTool.name === "bash" && isInspectionCommand(runningTool))
      return "Inspecting project state";
    if (isSearchTool(runningTool)) return "Searching codebase & references";
    if (runningTool.name === "bash") return "Executing shell command";
    return `Using tool ${runningTool.name}`;
  }

  const recent = r.tools.slice(-5);
  if (recent.some((t) => t.status === "failed"))
    return "Investigating tool failure";
  if (recent.some(isMutationTool)) return "Reviewing recent changes";
  if (recent.some((t) => t.name === "bash" && isValidationCommand(t)))
    return "Analyzing verification results";
  if (
    recent.length >= 2 &&
    recent.every((t) => isSearchTool(t) || (t.name === "bash" && isInspectionCommand(t)))
  )
    return "Mapping code structure";

  const intent = thinkingIntent(`${r.thinkingTail}\n${r.textTail}`);
  if (intent) return intent;
  if (!r.tools.length) return "Planning execution";
  return "Advancing task";
}

function progressState(d: ProgressDetails): string {
  const running = d.runs.filter((r) => r.status === "running").length;
  const failed = d.runs.some((r) => r.status === "failed");
  const paused = d.runs.some((r) => r.status === "paused");
  return failed
    ? "failed"
    : paused
      ? "paused"
      : d.final
        ? "completed"
        : running
          ? `${running} running`
          : "pending";
}

function progressDone(d: ProgressDetails): number {
  return d.runs.filter((r) => r.status !== "pending" && r.status !== "running").length;
}

function summaryText(text: string): string {
  return `${text.trim().replace(/[。.!?…]+$/u, "")}...`;
}

function splitModelThinking(model?: string, fallbackThinking?: string) {
  const m = model?.match(/^(.*):(off|minimal|low|medium|high|xhigh|max)$/i);
  return {
    model: m ? m[1] : model,
    thinking: (m?.[2] ?? fallbackThinking)?.toLowerCase(),
  };
}

function modelLabel(r: RunState): string | undefined {
  const { model, thinking } = splitModelThinking(r.model, r.thinking);
  if (!model) return undefined;
  return thinking && thinking !== "off" ? `${model}(${thinking})` : model;
}

function applyRunConfig(r: RunState, cfg: PiRunConfig) {
  const parsed = splitModelThinking(cfg.model, cfg.thinking);
  r.model = parsed.model;
  r.thinking = parsed.thinking;
}

function runElapsed(d: ProgressDetails, r: RunState): string {
  const start = r.startedAt ?? d.startedAt;
  const end = r.finishedAt ?? (r.status === "running" ? Date.now() : d.updatedAt);
  return fmtDur(Math.max(0, end - start));
}

function runHeader(d: ProgressDetails, r: RunState): string {
  const usage = fmtUsage(r.usage, modelLabel(r)) || fmtUsage(totalUsage(d));
  return `${r.agent} · ${progressDone(d)}/${d.runs.length} done · ${progressState(d)} · ${runElapsed(d, r)}${usage ? ` · ${usage}` : ""}`;
}

/**
 * Where pi persisted the child's session: `<agentDir>/sessions/<encoded cwd>/<ts>_<sessionId>.jsonl`.
 * Mirrors pi's getDefaultSessionDirPath (not exported). The full model behaviour history lives there.
 */
export function sessionLogPath(run: Pick<RunState, "cwd" | "sessionId">): string | undefined {
  if (!run.cwd) return undefined;
  const agentDir = process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
  const safe = `--${resolve(run.cwd).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  const dir = join(agentDir, "sessions", safe);
  try {
    const file = readdirSync(dir).find((n) => n.endsWith(`_${run.sessionId}.jsonl`));
    return file ? join(dir, file) : undefined;
  } catch {
    return undefined;
  }
}

function renderRunBlock(lines: string[], d: ProgressDetails, run: RunState, w: number) {
  const step = run.step ? `step ${run.step} · ` : "";
  lines.push(trunc(`  - ${step}${runHeader(d, run)}`, w));
  const summary = behaviorSummary(run);
  if (summary) lines.push(trunc(`    › ${summaryText(summary)}`, w));
  for (const t of run.tools.slice(-8)) {
    lines.push(trunc(`    ${toolIcon(t.status)} ${toolBrief(t)}`, w));
  }
  if (run.errorMessage) {
    lines.push(trunc(`    ✗ ${oneLine(run.errorMessage, 120)}`, w));
  }
  // The full behaviour history is the child's session file. Show the path on its own line
  // (home abbreviated to ~); when even that overflows, split at the last "/" so the two
  // pieces are a directory and a file name rather than an arbitrary character cut.
  const log = sessionLogPath(run);
  if (log) {
    const shown = abbreviateHome(log);
    lines.push("    ⎘ session log:");
    if (shown.length <= w) lines.push(shown);
    else {
      const cut = shown.lastIndexOf("/") + 1;
      lines.push(shown.slice(0, cut), shown.slice(cut));
    }
  }
}

function abbreviateHome(p: string): string {
  const home = homedir();
  return home && p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

/**
 * Progress card for `/subagent → task → View Progress` (live view). Same shape as
 * the former inline chat card — latest 8 tool calls per run, lines cut to width —
 * plus the session log path holding the full history (issue 088).
 */
export function renderProgressCard(d: ProgressDetails, w: number): string[] {
  const r = activeRun(d);
  if (!r) return [];
  const spinner = ["◐", "◓", "◑", "◒"][Math.floor(Date.now() / 250) % 4]!;
  const icon = d.final
    ? d.runs.some((x) => x.status === "failed")
      ? "✗"
      : d.runs.some((x) => x.status === "paused")
        ? "⏸"
        : "✓"
    : spinner;
  const totalElapsed = fmtDur((d.final ? d.updatedAt : Date.now()) - d.startedAt);
  const lines: string[] = [
    `${icon} subagent · total ${totalElapsed}`,
  ];

  for (const run of d.runs) renderRunBlock(lines, d, run, w);
  return lines.map((l) => trunc(l, w));
}

function progressKey(d: ProgressDetails): string {
  return d.runs
    .map((r) => {
      const t = r.tools.at(-1);
      return [
        r.id,
        r.status,
        r.tools.length,
        t?.id ?? "",
        t?.status ?? "",
        r.usage.turns,
        r.usage.input,
        r.usage.output,
        r.usage.cacheRead,
        r.usage.cacheWrite,
        r.usage.ctxTokens,
        r.model ?? "",
        r.thinking ?? "",
        r.errorMessage ?? "",
      ].join("~");
    })
    .join("|");
}

// ── Utilities ─────────────────────────────────────────────────────────
function isObj(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function hash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

function readText(p: string): string {
  try {
    return readFileSync(p, "utf-8");
  } catch {
    return "";
  }
}

function exists(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function fmtDur(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${s % 60}s`;
}

function fmtNum(n: number): string {
  if (!n) return "0";
  if (Math.abs(n) < 1000) return `${n}`;
  if (Math.abs(n) < 1000000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1000000).toFixed(1)}m`;
}

function fmtUsage(u: Usage, m?: string): string {
  const p: string[] = [];
  if (u.turns) p.push(`${u.turns}t`);
  if (u.input) p.push(`↑${fmtNum(u.input)}`);
  if (u.output) p.push(`↓${fmtNum(u.output)}`);
  if (u.cost) p.push(`$${u.cost.toFixed(3)}`);
  if (u.ctxTokens) p.push(`ctx:${fmtNum(u.ctxTokens)}`);
  if (m) p.push(m);
  return p.join(" ");
}

function toolIcon(s: ToolStatus): string {
  return s === "running" ? "•" : s === "succeeded" ? "✓" : "✗";
}

function appendTail(cur: string, next: string, max: number): string {
  if (!next) return cur;
  const c = cur + next;
  return c.length <= max ? c : c.slice(-max);
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) =>
      isObj(b) && b.type === "text" && typeof b.text === "string" ? b.text : "",
    )
    .join("");
}

function extractThinking(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((b) =>
      isObj(b) && b.type === "thinking" && typeof b.thinking === "string"
        ? b.thinking
        : "",
    )
    .join("\n");
}

function newUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    ctxTokens: 0,
    turns: 0,
  };
}

function newRun(
  id: string,
  agent: string,
  prompt: string,
  sessionId: string,
  step?: number,
): RunState {
  return {
    id,
    agent,
    prompt: trunc(prompt.replace(/\s+/g, " ").trim(), 120) || "(empty)",
    sessionId,
    step,
    status: "pending",
    finalText: "",
    textTail: "",
    thinkingTail: "",
    stderrTail: "",
    tools: [],
    usage: newUsage(),
  };
}

function cloneProgress(d: ProgressDetails): ProgressDetails {
  return {
    ...d,
    runs: d.runs.map((r) => ({
      ...r,
      tools: r.tools.map((t) => ({ ...t })),
      usage: { ...r.usage },
    })),
  };
}

function oneLine(v: unknown, max = 80): string {
  return String(v || "...")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function summarizeToolArgs(name: string, args: unknown): string {
  const a = isObj(args) ? args : {};
  const summary: JsonObject = {};
  if ("path" in a) summary.path = oneLine(a.path, 240);
  if ("file_path" in a) summary.file_path = oneLine(a.file_path, 240);
  if ("command" in a) summary.command = oneLine(a.command, 240);
  if ("pattern" in a) summary.pattern = oneLine(a.pattern, 120);
  if ("limit" in a) summary.limit = a.limit;
  if ("offset" in a) summary.offset = a.offset;
  if ("url" in a) summary.url = oneLine(a.url, 120);
  if ("query" in a) summary.query = oneLine(a.query, 120);
  if (name === "edit" && Array.isArray(a.edits))
    summary.edits = `${a.edits.length} edit(s)`;
  if (name === "write" && "content" in a)
    summary.content = `<${String(a.content ?? "").length} chars>`;
  const json = JSON.stringify(
    Object.keys(summary).length ? summary : { tool: name },
  );
  return json.length <= MAX_TOOL_ARG_CHARS
    ? json
    : json.slice(0, MAX_TOOL_ARG_CHARS);
}

function toolBrief(t: ToolTrace): string {
  const a = toolArgs(t);
  if (t.name === "read") return `read: ${oneLine(a.path || a.file_path, 80)}`;
  if (t.name === "bash") return `bash: ${oneLine(a.command, 60)}`;
  if (t.name === "write") return `write: ${oneLine(a.path || a.file_path, 80)}`;
  if (t.name === "edit") return `edit: ${oneLine(a.path || a.file_path, 80)}`;
  if (t.name === "grep") return `grep: ${oneLine(a.pattern, 50)}`;
  if (t.name === "find") return `find: ${oneLine(a.pattern || "*", 50)}`;
  if (t.name === "web_search") return `search: ${oneLine(a.query, 50)}`;
  if (t.name === "web_fetch") return `fetch: ${oneLine(a.url, 60)}`;
  return oneLine(t.name, 50);
}

// ── Pi CLI Resolution ─────────────────────────────────────────────────
const PI_CLI_SEGMENTS = [
  ["node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js"],
  ["node_modules", "@mariozechner", "pi-coding-agent", "dist", "cli.js"],
];

export function resolvePiCli(): { command: string; args: string[] } {
  const envCli = str(process.env.PI_CLI_JS);
  if (envCli) {
    const p = resolve(envCli);
    if (!exists(p)) throw new Error(`PI_CLI_JS missing: ${p}`);
    return { command: process.execPath, args: [p] };
  }
  const candidates: string[] = [];
  for (const arg of process.argv) {
    if (/pi-coding-agent[\\/]dist[\\/]cli\.js$/i.test(arg)) {
      candidates.push(resolve(arg));
    }
  }
  const prefix = str(process.env.npm_config_prefix) ?? str(process.env.NPM_CONFIG_PREFIX);
  const appData = str(process.env.APPDATA);
  const pathVal = process.env.PATH ?? process.env.Path ?? "";
  const addBase = (base: string) => {
    for (const seg of PI_CLI_SEGMENTS) candidates.push(join(base, ...seg));
  };
  if (prefix) {
    addBase(prefix);
    addBase(join(prefix, "lib"));
  }
  if (appData) addBase(join(appData, "npm"));
  for (const entry of pathVal.split(delimiter)) {
    const e = entry.trim();
    if (!e) continue;
    addBase(e);
    addBase(dirname(e));
    addBase(join(dirname(e), "lib"));
  }
  for (const c of [...new Set(candidates)]) {
    if (exists(c)) return { command: process.execPath, args: [c] };
  }
  return { command: "pi", args: [] };
}

// ── Agent file parsing ────────────────────────────────────────────────
function splitFM(c: string) {
  const m = c.replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  return m
    ? { fm: m[1] ?? "", body: c.slice(m[0].length) }
    : { fm: "", body: c };
}

export function parseAgentFile(filePath: string): AgentConfig {
  const text = readText(filePath);
  if (!text) return {};
  const { fm, body } = splitFM(text);
  const cfg: AgentConfig = { systemPrompt: body.trim() || undefined };
  for (const rawLine of fm.split(/\r?\n/)) {
    const m = rawLine.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const k = m[1] ?? "",
      v = (m[2] ?? "").trim().replace(/^["']|["']$/g, "");
    if (k === "model") cfg.model = v || undefined;
    else if (k === "thinking") cfg.thinking = v || undefined;
    else if (k === "tools") {
      cfg.tools = v
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    }
  }
  return cfg;
}

export function findAgentDefinition(cwd: string, agentName?: string): { config: AgentConfig; found: boolean } {
  if (!agentName) return { config: {}, found: false };
  const sanitized = agentName.replace(/[\\/]/g, "").replace(/\.\./g, "").trim().toLowerCase();
  if (!sanitized) return { config: {}, found: false };
  const baseName = sanitized.endsWith(".md") ? sanitized : `${sanitized}.md`;
  const agentHome = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  const candidates = [
    join(cwd, ".pi", "agents", baseName),
    join(agentHome, "agents", baseName),
    join(homedir(), ".pi", "agents", baseName),
    join(BUILTIN_AGENTS_DIR, baseName),
  ];
  for (const p of candidates) {
    if (exists(p)) {
      return { config: parseAgentFile(p), found: true };
    }
  }

  return { config: {}, found: false };
}

export function resolveRunCfg(
  item: Partial<SubagentTaskItem>,
  agentCfg: AgentConfig,
  inheritedThinking?: string,
  inheritedModel?: string,
  subagentSettings?: SubagentSettings,
): PiRunConfig {
  const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
  const normalize = (v: unknown): string | undefined => {
    const s = typeof v === "string" && v.trim() ? v.trim().toLowerCase() : "";
    return THINKING_LEVELS.includes(s) ? s : undefined;
  };
  const suffixRe = /:(off|minimal|low|medium|high|xhigh|max)$/i;

  const roleSettings = item.agent ? subagentSettings?.agents?.[item.agent] : undefined;

  const roleModel = str(roleSettings?.model);
  const agentModel = str(agentCfg.model);
  const defaultModel = str(subagentSettings?.defaultModel);
  const rawModel = roleModel ?? agentModel ?? defaultModel ?? str(inheritedModel);

  const roleSuffixThinking = normalize(roleModel?.match(suffixRe)?.[1]);
  const agentSuffixThinking = normalize(agentModel?.match(suffixRe)?.[1]);
  const defaultSuffixThinking = normalize(defaultModel?.match(suffixRe)?.[1]);

  const baseModel = rawModel?.replace(suffixRe, "");
  const thinking =
    normalize(roleSettings?.thinking) ??
    roleSuffixThinking ??
    normalize(agentCfg.thinking) ??
    agentSuffixThinking ??
    normalize(subagentSettings?.defaultThinking) ??
    defaultSuffixThinking ??
    normalize(inheritedThinking);

  const tools =
    item.tools?.length
      ? item.tools
      : roleSettings?.tools?.length
        ? roleSettings.tools
        : agentCfg.tools;
  const cwd = item.cwd ? resolve(item.cwd) : undefined;
  const resumeSession = str(item.resume);
  const sessionId = item.id ? str(item.id) : undefined;
  const timeoutMs = typeof item.timeoutMs === "number" && item.timeoutMs > 0 ? item.timeoutMs : undefined;
  const maxTurns = typeof item.maxTurns === "number" && item.maxTurns > 0 ? item.maxTurns : undefined;

  // Bake the level into the model string whenever a model exists, "off" included:
  // buildPiArgs cannot append through a model id that itself contains a colon.
  if (baseModel && thinking) {
    return {
      model: `${baseModel}:${thinking}`,
      thinking,
      tools,
      cwd,
      sessionId: sessionId || undefined,
      resumeSession: resumeSession || undefined,
      timeoutMs,
      maxTurns,
    };
  }
  return {
    model: baseModel || rawModel || undefined,
    thinking,
    tools,
    cwd,
    sessionId: sessionId || undefined,
    resumeSession: resumeSession || undefined,
    timeoutMs,
    maxTurns,
  };
}

export function buildPiArgs(cfg: PiRunConfig): string[] {
  const args = ["--mode", "json", "-p"];
  if (cfg.resumeSession) {
    args.push("--session", cfg.resumeSession);
  } else if (cfg.sessionId) {
    args.push("--session-id", cfg.sessionId);
  }

  if (cfg.model) {
    // A thinking level is a real level, "off" included: appending it is what makes
    // inheritance faithful when the parent session sits at off. pi clamps the
    // requested level to the child model's supported set.
    args.push(
      "--model",
      cfg.thinking && !cfg.model.includes(":")
        ? `${cfg.model}:${cfg.thinking}`
        : cfg.model,
    );
  } else if (cfg.thinking) {
    args.push("--thinking", cfg.thinking);
  }
  if (cfg.tools && cfg.tools.length > 0) {
    args.push("--tools", cfg.tools.join(","));
  }
  return args;
}

// ── BoundedBufferCollector ─────────────────────────────────────────────
class BBC {
  private c: Buffer[] = [];
  private len = 0;
  private trunc = 0;
  constructor(private max: number) {}
  append(b: Buffer) {
    if (b.length >= this.max) {
      this.trunc += this.len + b.length - this.max;
      this.c = [b.subarray(b.length - this.max)];
      this.len = this.max;
      return;
    }
    this.c.push(b);
    this.len += b.length;
    while (this.len > this.max) {
      const f = this.c[0]!;
      if (f.length <= this.len - this.max) {
        this.c.shift();
        this.len -= f.length;
        this.trunc += f.length;
      } else {
        const ov = this.len - this.max;
        this.c[0] = f.subarray(ov);
        this.len -= ov;
        this.trunc += ov;
        break;
      }
    }
  }
  toString(): string {
    const body = Buffer.concat(this.c, this.len).toString("utf-8");
    return this.trunc ? `[${this.trunc} bytes truncated]\n${body}` : body;
  }
}

// ── Event parsing ─────────────────────────────────────────────────────
export function parseJsonEvent(line: string): JsonObject | null {
  const t = line.trim();
  if (!t) return null;
  const i = t.indexOf("{");
  if (i < 0) return null;
  try {
    const p = JSON.parse(t.slice(i));
    return isObj(p) ? p : null;
  } catch {
    return null;
  }
}

export function applyEvent(r: RunState, evt: JsonObject): boolean {
  const type = typeof evt.type === "string" ? evt.type : "";
  if (!type) return false;
  if (type === "agent_start" || type === "turn_start") {
    r.status = "running";
    r.startedAt ??= Date.now();
    return true;
  }
  if (type === "message_update") {
    const ae = isObj(evt.assistantMessageEvent)
      ? evt.assistantMessageEvent
      : null;
    if (!ae || typeof ae.delta !== "string") return false;
    if (ae.type === "thinking_delta") {
      r.thinkingTail = appendTail(r.thinkingTail, ae.delta, MAX_TAIL);
      return true;
    }
    if (ae.type === "text_delta") {
      r.textTail = appendTail(r.textTail, ae.delta, MAX_TAIL);
      return true;
    }
    return false;
  }
  if (type === "message_end" && isObj(evt.message)) {
    const msg = evt.message;
    if (msg.role !== "assistant") return false;
    r.usage.turns += 1;
    const u = isObj(msg.usage) ? msg.usage : null;
    const cost = isObj(u?.cost) ? u.cost : null;
    r.usage.input += num(u?.input);
    r.usage.output += num(u?.output);
    r.usage.cacheRead += num(u?.cacheRead);
    r.usage.cacheWrite += num(u?.cacheWrite);
    r.usage.cost += num(cost?.total);
    r.usage.ctxTokens = num(u?.totalTokens);
    const thinking = extractThinking(msg.content);
    if (thinking) r.thinkingTail = appendTail("", thinking, MAX_TAIL);
    const text = extractText(msg.content);
    if (text) {
      r.finalText = text;
      r.textTail = appendTail("", text, MAX_TAIL);
    }
    if (typeof msg.model === "string") {
      const parsed = splitModelThinking(msg.model, r.thinking);
      r.model = parsed.model;
      r.thinking = parsed.thinking;
    }
    if (typeof msg.errorMessage === "string") r.errorMessage = msg.errorMessage;
    return true;
  }
  if (type === "tool_execution_start") {
    const id =
      typeof evt.toolCallId === "string"
        ? evt.toolCallId
        : hash(`${Date.now()}_${++toolCallCounter}`);
    const name = typeof evt.toolName === "string" ? evt.toolName : "tool";
    const args = summarizeToolArgs(name, evt.args);
    const existing = r.tools.findIndex((t) => t.id === id);
    if (existing >= 0) {
      r.tools[existing] = { ...r.tools[existing]!, args, status: "running" };
    } else {
      r.tools.push({
        id,
        name,
        args,
        status: "running",
        startedAt: Date.now(),
      });
    }
    if (r.tools.length > MAX_TOOLS) {
      r.tools.splice(0, r.tools.length - MAX_TOOLS);
    }
    return true;
  }
  if (type === "tool_execution_end") {
    const id = typeof evt.toolCallId === "string" ? evt.toolCallId : "";
    const idx = r.tools.findIndex((t) => t.id === id);
    if (idx >= 0) {
      r.tools[idx] = {
        ...r.tools[idx]!,
        status: evt.isError ? "failed" : "succeeded",
        finishedAt: Date.now(),
      };
    }
    return true;
  }
  if (type === "agent_end") {
    r.finishedAt = Date.now();
    if (r.status === "running" || r.status === "pending") {
      r.status = "succeeded";
    }
    return true;
  }
  return false;
}

function finalize(r: RunState, fallback: string): string {
  return r.finalText || fallback.trim() || r.stderrTail.trim();
}

function formatPiOutput(stdout: string, stderr: string): string {
  let ft = "";
  for (const line of stdout.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      const evt = JSON.parse(t) as JsonObject;
      const msg = isObj(evt.message) ? evt.message : null;
      if (msg?.role === "assistant") {
        const txt = extractText(msg.content);
        if (txt) ft = txt;
      }
    } catch {}
  }
  if (ft) return ft;
  const raw = stdout || stderr;
  return raw.length > MAX_FALLBACK_OUTPUT_CHARS
    ? `[truncated output]\n${raw.slice(-MAX_FALLBACK_OUTPUT_CHARS)}`
    : raw;
}

// ── Subprocess runner ─────────────────────────────────────────────────
export function runPi(
  cwd: string,
  prompt: string,
  cfg: PiRunConfig,
  state: RunState,
  emit: () => void,
  signal?: AbortSignal,
): Promise<{ output: string; failed: boolean; paused?: boolean }> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      state.status = "cancelled";
      state.errorMessage = "cancelled";
      state.finishedAt = Date.now();
      emit();
      resolve({ output: "cancelled", failed: true });
      return;
    }
    const inv = resolvePiCli();
    const childEnv = {
      ...process.env,
      PI_SUBAGENT_CHILD: "1",
    };
    const targetCwd = cfg.cwd || cwd;
    state.cwd = targetCwd;
    const cli = spawn(inv.command, [...inv.args, ...buildPiArgs(cfg)], {
      cwd: targetCwd,
      env: childEnv,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout = new BBC(MAX_STDOUT);
    const stderr = new BBC(MAX_STDERR);
    const stdoutDecoder = new StringDecoder("utf-8");
    const stderrDecoder = new StringDecoder("utf-8");
    let buf = "";
    let settled = false;
    let aborted = false;
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxTurns = cfg.maxTurns ?? DEFAULT_MAX_TURNS;

    const abort = (reason?: "timeout" | "max_turns") => {
      aborted = true;
      if (reason) state.pauseReason = reason;
      cli.kill();
      killTimer = setTimeout(() => {
        if (!settled && cli.exitCode === null) cli.kill("SIGKILL");
      }, ABORT_KILL_GRACE_MS);
      killTimer?.unref?.();
    };

    if (timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        abort("timeout");
      }, timeoutMs);
      timeoutTimer?.unref?.();
    }

    const onAbort = () => abort();
    const done = (v: { output: string; failed: boolean; paused?: boolean }) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      signal?.removeEventListener("abort", onAbort);
      emit();
      resolve(v);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    state.status = "running";
    state.startedAt = Date.now();
    emit();

    const processLine = (line: string) => {
      const evt = parseJsonEvent(line);
      if (evt && applyEvent(state, evt)) {
        emit();
        if (state.usage.turns >= maxTurns && !aborted) {
          abort("max_turns");
        }
      }
    };

    cli.stdout?.on("data", (d: Buffer) => {
      stdout.append(d);
      buf += stdoutDecoder.write(d);
      if (buf.length > MAX_LINE_BUFFER) buf = buf.slice(-MAX_LINE_BUFFER);
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const l of lines) processLine(l);
    });

    cli.stderr?.on("data", (d: Buffer) => {
      stderr.append(d);
      state.stderrTail = appendTail(
        state.stderrTail,
        stderrDecoder.write(d),
        MAX_TAIL,
      );
    });

    cli.stdin?.on("error", (e: Error & { code?: string }) => {
      if (!aborted && e.code !== "EPIPE") {
        done({ output: e.message, failed: true });
      }
    });

    cli.on("error", (e) => {
      state.status = aborted ? "cancelled" : "failed";
      state.errorMessage = e instanceof Error ? e.message : String(e);
      state.finishedAt = Date.now();
      done({ output: finalize(state, state.errorMessage), failed: true });
    });

    cli.on("close", (code) => {
      buf += stdoutDecoder.end();
      if (buf.trim()) processLine(buf);
      const out = stdout.toString();
      const err = stderr.toString();
      state.stderrTail = appendTail("", stderrDecoder.end() || err, MAX_TAIL);
      state.finishedAt = Date.now();

      if (state.pauseReason) {
        state.status = "paused";
        const reasonText =
          state.pauseReason === "timeout"
            ? `timed out after ${fmtDur(timeoutMs)}`
            : `reached maximum limit of ${maxTurns} turns`;
        const partialResult = finalize(state, formatPiOutput(out, err));
        const notice = `\n\n---\n⚠️ [Subagent session ${state.sessionId} paused: ${reasonText}]\n💡 To resume this session from where it left off, call: subagent({ resume: "${state.sessionId}", task: "Continue the remaining work" })`;
        done({
          output: partialResult ? `${partialResult}${notice}` : notice.trim(),
          failed: false,
          paused: true,
        });
        return;
      }

      if (aborted) {
        state.status = "cancelled";
        state.errorMessage = "cancelled";
        done({ output: finalize(state, "cancelled"), failed: true });
        return;
      }
      if (code === 0) {
        if (state.status === "pending" || state.status === "running") {
          state.status = "succeeded";
        }
        done({
          output: finalize(state, formatPiOutput(out, err)),
          failed: false,
        });
        return;
      }
      state.status = "failed";
      const errBrief = err.trim() || out.trim() || `exit ${code ?? "?"}`;
      state.errorMessage =
        errBrief.length > MAX_FALLBACK_OUTPUT_CHARS
          ? errBrief.slice(-MAX_FALLBACK_OUTPUT_CHARS)
          : errBrief;
      done({ output: finalize(state, state.errorMessage), failed: true });
    });

    cli.stdin?.end(prompt);
  });
}

function buildSubagentPrompt(task: string, agentDef: AgentConfig): string {
  if (agentDef.systemPrompt) {
    return `${agentDef.systemPrompt}\n\n---\n## Assigned Task\n${task}`;
  }
  return task;
}

// ── Normalization Helper ──────────────────────────────────────────────
/** One call = one task (issue 095). Known fields only; model/thinking never pass through. */
export function normalizeTask(input: SubagentInput): SubagentTaskItem {
  const task = String(input.task || "").trim();
  if (!task) throw new Error("No task specified. Provide 'task' with the prompt to execute.");
  return {
    task,
    agent: input.agent,
    tools: input.tools,
    cwd: input.cwd,
    resume: input.resume,
    id: input.id,
    timeoutMs: typeof input.timeoutMs === "number" && input.timeoutMs > 0 ? input.timeoutMs : undefined,
    maxTurns: typeof input.maxTurns === "number" && input.maxTurns > 0 ? input.maxTurns : undefined,
  };
}

/** Plain-text one-liner for the record description, status bar and exit messages (no ANSI). */
export function describeTask(item: SubagentTaskItem): string {
  const head = oneLine(item.task, 60);
  return item.agent ? `${item.agent}: ${head}` : head;
}

// ── Task Manager ──────────────────────────────────────────────────
export interface SubagentTaskRecord {
  id: string;
  parentSessionId: string;
  description: string;
  agent?: string;
  status: "running" | "succeeded" | "failed" | "cancelled" | "paused";
  output: string;
  startedAt: number;
  finishedAt?: number;
  controller: AbortController;
  notifyOnExit: boolean;
  done?: Promise<void>;
  pauseReason?: "timeout" | "max_turns";
  /** Latest streamed progress; the single source for status bar and menu views. */
  progress?: ProgressDetails;
}

export type BackgroundSubagentTask = SubagentTaskRecord;

/**
 * Pure-data snapshot of a finished task for sendMessage details. Pi core runs
 * structuredClone over session messages before every LLM call, and live objects
 * like Promise / AbortController make that throw — so anything handed to
 * sendMessage must be clone-safe (strings, numbers, booleans only).
 */
export function toMessageDetails(task: SubagentTaskRecord): Record<string, unknown> {
  const { controller: _controller, done: _done, notifyOnExit: _notifyOnExit, progress: _progress, ...safe } = task;
  return safe;
}

/**
 * Footer text: `sub:N · <agent> <elapsed> · …` per running task, oldest first.
 * Caps at 3 entries (`+N more`) to keep the footer short; per-task detail lives
 * in /subagent and subagent_status (issue 095: records are now 1:1 with children,
 * so each deserves a slot).
 */
export function formatSubagentStatus(tasks: SubagentTaskRecord[], now = Date.now()): string | undefined {
  const running = tasks.filter((t) => t.status === "running");
  if (running.length === 0) return undefined;
  const sorted = [...running].sort((a, b) => a.startedAt - b.startedAt);
  const parts = sorted
    .slice(0, 3)
    .map((t) => `${t.agent ?? "subagent"} ${fmtDur(Math.max(0, now - t.startedAt))}`);
  const rest = running.length - parts.length;
  if (rest > 0) parts.push(`+${rest} more`);
  return `sub:${running.length} · ${parts.join(" · ")}`;
}

/**
 * Compact plain-text status for the subagent_status tool: header + activity +
 * recent tool calls + child session log path. The task's output is NOT included —
 * it is delivered by the exit notification (issue 095).
 */
export function formatSubagentTaskStatus(task: SubagentTaskRecord, now = Date.now()): string {
  const elapsed = fmtDur(Math.max(0, (task.finishedAt ?? now) - task.startedAt));
  const lines = [
    `[${task.id}] ${task.agent ?? "subagent"} · ${task.status} · ${elapsed}`,
    `Task: ${task.description}`,
  ];
  const run = task.progress?.runs[0];
  if (!run) return lines.join("\n") + "\n(no progress yet)";
  const active = run.tools.find((t) => t.status === "running");
  const usage = fmtUsage(run.usage, modelLabel(run));
  const parts = [
    active ? `current: ${toolBrief(active)}` : undefined,
    run.usage.turns ? `turn ${run.usage.turns}` : undefined,
    usage || undefined,
  ].filter((p): p is string => Boolean(p));
  if (parts.length) lines.push(parts.join(" · "));
  const recent = run.tools.slice(-5);
  if (recent.length) {
    lines.push("Recent tools:");
    for (const t of recent) {
      const icon = t.status === "running" ? "▸" : t.status === "failed" ? "✗" : "✓";
      lines.push(`  ${icon} ${toolBrief(t)}`);
    }
  }
  const log = sessionLogPath(run);
  if (log) lines.push(`⎘ session log: ${log}`);
  return lines.join("\n");
}

export class SubagentTaskManager {
  constructor(private readonly tasks: Map<string, SubagentTaskRecord> = new Map()) {}
  private onExit?: (task: SubagentTaskRecord) => void;
  private onChange?: () => void;

  init(onExit: (task: SubagentTaskRecord) => void, onChange?: () => void): void {
    this.onExit = onExit;
    this.onChange = onChange;
  }

  register(task: SubagentTaskRecord): void {
    this.tasks.set(task.id, task);
    this.emitChange();
  }

  get(id: string): SubagentTaskRecord | undefined {
    return this.tasks.get(id);
  }

  stop(id: string): boolean {
    const t = this.tasks.get(id);
    if (!t || t.status !== "running") return false;
    t.controller.abort();
    t.status = "cancelled";
    t.finishedAt = Date.now();
    this.emitChange();
    return true;
  }

  setProgress(id: string, progress: ProgressDetails): void {
    const t = this.tasks.get(id);
    if (!t || t.status !== "running") return;
    t.progress = progress;
    this.emitChange();
  }

  complete(id: string, output: string, failed: boolean, cancelled = false, paused = false): void {
    const t = this.tasks.get(id);
    if (!t) return;
    t.status = cancelled ? "cancelled" : paused ? "paused" : failed ? "failed" : "succeeded";
    t.output = output;
    t.finishedAt = Date.now();
    this.emitChange();
    if (t.notifyOnExit) {
      try {
        this.onExit?.(t);
      } catch {}
    }
  }

  list(parentSessionId?: string): SubagentTaskRecord[] {
    return Array.from(this.tasks.values())
      .filter((t) => !parentSessionId || t.parentSessionId === parentSessionId)
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  getRunningCount(parentSessionId?: string): number {
    return Array.from(this.tasks.values()).filter(
      (t) => (!parentSessionId || t.parentSessionId === parentSessionId) && t.status === "running",
    ).length;
  }

  async clearSession(parentSessionId: string): Promise<void> {
    const sessionTasks = Array.from(this.tasks.values()).filter(
      (t) => t.parentSessionId === parentSessionId,
    );
    for (const t of sessionTasks) {
      t.notifyOnExit = false;
      if (t.status === "running") t.controller.abort();
      this.tasks.delete(t.id);
    }
    await Promise.all(sessionTasks.map((t) => t.done?.catch(() => {})));
    this.emitChange();
  }

  private emitChange(): void {
    try {
      this.onChange?.();
    } catch {}
  }
}

export const SubagentBackgroundManager = SubagentTaskManager;
export type SubagentBackgroundManager = SubagentTaskManager;

// /reload re-evaluates this module. Pin the task *data* (a Map) to a process global so tasks
// started before a reload stay visible and stoppable, but build the manager itself fresh each
// load so its methods always come from the current code. Pinning the instance instead left an
// old prototype alive after an upgrade-reload ("setProgress is not a function", issue 088).
const SUBAGENT_TASKS_KEY = Symbol.for("@bytetrue/pi-subagent.tasks");
const globalStore = globalThis as unknown as Record<symbol, Map<string, SubagentTaskRecord> | undefined>;
export const subagentManager: SubagentTaskManager = new SubagentTaskManager(
  (globalStore[SUBAGENT_TASKS_KEY] ??= new Map()),
);

// ── Orchestrator ──────────────────────────────────────────────────────
export async function runSubagent(
  cwd: string,
  input: SubagentInput,
  signal?: AbortSignal,
  onUpdate?: (r: PiToolResult) => void,
  inheritedThinking?: string,
  inheritedModel?: string,
): Promise<{ output: string; details: ProgressDetails; failed: boolean; paused?: boolean }> {
  const item = normalizeTask(input);

  const subagentSettings = loadSubagentSettings(cwd, true);
  const startedAt = Date.now();
  const details: ProgressDetails = {
    kind: "pi-subagent-progress",
    agent: item.agent || "subagent",
    startedAt,
    updatedAt: startedAt,
    final: false,
    runs: [],
  };

  let lastEmit = 0;
  let lastPartialKey = "";
  let closed = false;

  const pushPartial = (force = false) => {
    if (closed || !onUpdate) return;
    const key = progressKey(details);
    if (!force && key === lastPartialKey) return;
    lastPartialKey = key;
    onUpdate({
      content: [{ type: "text", text: "subagent running" }],
      details: cloneProgress(details),
    });
  };

  const emit = (force = false) => {
    const now = Date.now();
    if (!force && now - lastEmit < THROTTLE_MS) return;
    lastEmit = now;
    details.updatedAt = now;
    pushPartial(force);
  };

  const finish = (output: string, failed: boolean, paused = false) => {
    closed = true;
    details.final = true;
    details.updatedAt = Date.now();
    return { output, details: cloneProgress(details), failed, paused };
  };

  try {
    const role = item.agent || "subagent";
    const sessionId = item.resume || item.id || `sub_${randomBytes(6).toString("hex")}`;
    const { config: agentCfg } = findAgentDefinition(cwd, item.agent);
    const runCfg = resolveRunCfg(
      { ...item, id: sessionId },
      agentCfg,
      inheritedThinking,
      inheritedModel,
      subagentSettings,
    );
    const run = newRun(role, role, item.task, sessionId);
    applyRunConfig(run, runCfg);
    details.runs.push(run);
    emit(true);

    const result = await runPi(
      cwd,
      buildSubagentPrompt(item.task, agentCfg),
      runCfg,
      run,
      emit,
      signal,
    );
    return finish(result.output, result.failed, Boolean(result.paused));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const r = activeRun(details);
    if (r) {
      r.status = "failed";
      r.errorMessage = message;
      r.finishedAt = Date.now();
    }
    return finish(message, true);
  }
}

// ── Extension Entry Point ─────────────────────────────────────────────
export default function subagentExtension(pi: {
  registerTool?: (tool: JsonObject) => void;
  registerCommand?: (
    name: string,
    opts: {
      description?: string;
      handler: (args: string, ctx: ExtensionCommandContext) => unknown;
    },
  ) => void;
  registerShortcut?: (
    key: string,
    opts: {
      description?: string;
      handler: (ctx: PiExtensionContext) => unknown;
    },
  ) => void;
  sendMessage?: (
    message: { customType?: string; content: string; display?: boolean; details?: unknown },
    opts?: { deliverAs?: "followUp" | "steer"; triggerTurn?: boolean },
  ) => void;
  on?: (
    event: string,
    handler: (event: unknown, ctx?: PiExtensionContext) => unknown,
  ) => void;
  getThinkingLevel?: () => string;
}): void {
  if (process.env.PI_SUBAGENT_CHILD === "1") return;

  let currentSessionId: string | null = null;
  let updateStatus: (() => void) | undefined;
  let agentBusy = false;
  let pendingExits: BackgroundSubagentTask[] = [];
  let statusTicker: ReturnType<typeof setInterval> | undefined;
  let activeParentModel: string | undefined = undefined;
  let activeParentThinking: string | undefined = undefined;

  const trackSessionModel = (modelObj?: { provider?: string; id?: string }) => {
    if (modelObj?.provider && modelObj?.id) {
      activeParentModel = `${modelObj.provider}/${modelObj.id}`;
    }
  };

  const resolveInheritedModel = (ctx?: PiExtensionContext): string | undefined => {
    // 1. Context model from tool execution
    if (ctx?.model?.provider && ctx?.model?.id) {
      activeParentModel = `${ctx.model.provider}/${ctx.model.id}`;
      return activeParentModel;
    }
    // 2. Tracked active parent model
    if (activeParentModel) {
      return activeParentModel;
    }
    // 3. Environment variables (PI_PROVIDER & PI_MODEL)
    const envProvider = process.env.PI_PROVIDER?.trim();
    const envModel = process.env.PI_MODEL?.trim();
    if (envProvider && envModel) {
      return `${envProvider}/${envModel}`;
    }
    if (envModel && envModel.includes("/")) {
      return envModel;
    }
    // 4. No inherited model: leave unset so the child pi process uses its own default
    return undefined;
  };

  const resolveInheritedThinking = (): string | undefined => {
    return (
      pi.getThinkingLevel?.() ??
      activeParentThinking ??
      process.env.PI_REASONING_LEVEL?.trim() ??
      undefined
    );
  };

  const flushPendingExits = () => {
    const batch = pendingExits;
    pendingExits = [];
    const first = batch[0];
    if (!first) return;
    const content =
      batch.length === 1
        ? formatSubagentExitMessage(first)
        : `${batch.length} background subagent tasks completed:\n\n${batch.map(formatSubagentExitMessage).join("\n\n---\n\n")}`;
    pi.sendMessage?.(
      {
        customType: "subagent-exit",
        content,
        display: true,
        details: batch.length === 1 ? toMessageDetails(first) : batch.map(toMessageDetails),
      },
      { deliverAs: "followUp", triggerTurn: true },
    );
  };

  subagentManager.init(
    (task) => {
      if (!currentSessionId || task.parentSessionId !== currentSessionId) return;
      pendingExits.push(task);
      if (!agentBusy) flushPendingExits();
    },
    () => updateStatus?.(),
  );

  pi.registerCommand?.("subagent", {
    description: "Configure subagent default/role models and thinking levels",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      await runSubagentCommand(ctx, args);
    },
  });

  pi.registerTool?.({
    name: "subagent",
    label: "Subagent",
    description:
      "Delegate ONE task to an isolated child agent session. Built-in roles: 'scout' (read-only recon), 'researcher' (web/doc research), 'reviewer' (code review & tests). The call returns at once with a task id; the full result arrives later as a new message that starts your next turn — until then, continue with other work or end your turn. To run several tasks at once, make multiple subagent calls in the same message; use subagent_status to check one and subagent_stop to stop one. Supports session resumption.",
    promptSnippet:
      "Delegate work to child agents (scout / researcher / reviewer); the call returns at once and the result arrives later as a new message.",
    // Positive-first wording (decision 001): state the wait model instead of only forbidding polling.
    promptGuidelines: [
      "Delegate self-contained recon, research, or review to subagent so you stay free to keep working or hand control back to the user",
      "After a subagent starts, continue with other work or end your turn; its complete output arrives as a new message that starts your next turn",
    ],
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "The task prompt to execute (REQUIRED).",
        },
        agent: {
          type: "string",
          description:
            "Optional agent role (e.g. 'scout', 'researcher', 'reviewer', or custom name).",
        },
        tools: {
          type: "array",
          items: { type: "string" },
          description: "Optional tool allowlist (e.g. ['read', 'grep', 'find']).",
        },
        cwd: {
          type: "string",
          description: "Optional working directory.",
        },
        resume: {
          type: "string",
          description: "Optional session ID or partial UUID to resume a previous subagent session.",
        },
        timeoutMs: {
          type: "number",
          description: "Optional timeout in milliseconds. Default: 1200000 (20 minutes).",
        },
        maxTurns: {
          type: "number",
          description: "Optional maximum turns before pausing. Default: 50.",
        },
      },
      required: ["task"],
    },
    execute: async (
      _id: string,
      input: SubagentInput,
      _signal?: AbortSignal,
      _onUpdate?: (r: PiToolResult) => void,
      ctx?: PiExtensionContext,
    ) => {
      const cwd = process.cwd();
      const inheritedThinking = resolveInheritedThinking();
      const inheritedModel = resolveInheritedModel(ctx);

      const item = normalizeTask(input);

      // Pure background (issue 088): the call returns at once; progress streams into
      // the manager record (status bar + /subagent menu) and the result arrives as a
      // followUp message via subagentManager.complete → onExit.
      const taskId = `sub_${randomBytes(6).toString("hex")}`;
      const sessionId =
        ctx?.sessionManager?.getSessionId?.() ?? currentSessionId ?? "default";
      const controller = new AbortController();

      const record: SubagentTaskRecord = {
        id: taskId,
        parentSessionId: sessionId,
        description: describeTask(item),
        agent: item.agent,
        status: "running",
        output: "",
        startedAt: Date.now(),
        controller,
        notifyOnExit: true,
        done: Promise.resolve(),
      };

      const onProgress = (r: PiToolResult) => {
        if (isObj(r.details) && r.details.kind === "pi-subagent-progress") {
          subagentManager.setProgress(taskId, r.details as unknown as ProgressDetails);
        }
      };

      const execution = runSubagent(
        cwd,
        input,
        controller.signal,
        onProgress,
        inheritedThinking,
        inheritedModel,
      )
        .then((res) => {
          subagentManager.complete(
            taskId,
            res.output,
            res.failed,
            controller.signal.aborted,
            res.paused,
          );
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          subagentManager.complete(taskId, msg, true, controller.signal.aborted);
        });

      record.done = execution;
      subagentManager.register(record);

      return {
        content: [
          {
            type: "text",
            text: `Subagent started (ID: ${taskId}). Its full result will arrive as a new message — continue with other work or end your turn now.`,
          },
        ],
        details: { id: taskId, status: "running" },
      };
    },
  });

  const findSessionTask = (
    id: string,
    ctx?: PiExtensionContext,
  ): BackgroundSubagentTask | undefined => {
    if (!id) return undefined;
    const task = subagentManager.get(id);
    const sessionId = ctx?.sessionManager?.getSessionId?.() ?? currentSessionId ?? "default";
    return task && task.parentSessionId === sessionId ? task : undefined;
  };

  pi.registerTool?.({
    name: "subagent_status",
    label: "Subagent Status",
    description:
      "Check one subagent task by id: status, elapsed time, current activity (running tool, turns, token/cost, model), recent tool calls, and the child session log path — read that file for the full model behaviour history. The full result is reported automatically as a new message when the task completes, so don't poll.",
    promptSnippet: "Check one subagent task.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task id from the subagent call." },
      },
      required: ["id"],
    },
    execute: async (
      _id: string,
      input: { id?: string },
      _signal?: AbortSignal,
      _onUpdate?: (r: PiToolResult) => void,
      ctx?: PiExtensionContext,
    ) => {
      const task = findSessionTask(String(input?.id ?? "").trim(), ctx);
      if (!task) throw new Error(`No subagent task found with id "${input?.id}".`);
      const status = formatSubagentTaskStatus(task);
      const text =
        task.status === "running"
          ? `${status}\nResult arrives as a new message when it completes.`
          : status;
      return { content: [{ type: "text", text }], details: toMessageDetails(task) };
    },
  });

  pi.registerTool?.({
    name: "subagent_stop",
    label: "Stop Subagent",
    description: "Stop a running subagent task by id. A cancellation notice arrives as a new message.",
    promptSnippet: "Stop one subagent task.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task id from the subagent call." },
      },
      required: ["id"],
    },
    execute: async (
      _id: string,
      input: { id?: string },
      _signal?: AbortSignal,
      _onUpdate?: (r: PiToolResult) => void,
      ctx?: PiExtensionContext,
    ) => {
      const task = findSessionTask(String(input?.id ?? "").trim(), ctx);
      if (!task) throw new Error(`No subagent task found with id "${input?.id}".`);
      if (task.status !== "running" || !subagentManager.stop(task.id)) {
        const settled = subagentManager.get(task.id) ?? task;
        return {
          content: [
            { type: "text", text: `[${settled.id}] is already ${settled.status}; nothing to stop.` },
          ],
          details: toMessageDetails(settled),
        };
      }
      const stopped = subagentManager.get(task.id) ?? task;
      return {
        content: [{ type: "text", text: `Stopped ${stopped.id} (${stopped.agent ?? "subagent"}).` }],
        details: toMessageDetails(stopped),
      };
    },
  });

  pi.on?.("agent_start", () => {
    agentBusy = true;
  });

  pi.on?.("agent_settled", () => {
    agentBusy = false;
    flushPendingExits();
  });

  pi.on?.("session_start", (_event, ctx) => {
    trackSessionModel(ctx?.model);
    const sessionId = ctx?.sessionManager?.getSessionId?.() ?? "default";
    currentSessionId = sessionId;
    // Progress events are throttled and stop while the child thinks, so a 1s ticker
    // keeps the elapsed time honest while anything runs; it is cleared when idle.
    updateStatus = () => {
      const text = formatSubagentStatus(subagentManager.list(sessionId));
      ctx?.ui?.setStatus?.("subagent", text);
      if (text && !statusTicker) {
        statusTicker = setInterval(() => updateStatus?.(), 1000);
        statusTicker.unref?.();
      } else if (!text && statusTicker) {
        clearInterval(statusTicker);
        statusTicker = undefined;
      }
    };
    updateStatus();
  });

  pi.on?.("before_agent_start", (_event, ctx) => {
    trackSessionModel(ctx?.model);
  });

  pi.on?.("model_select", (event) => {
    const ev = event as { model?: { provider?: string; id?: string } };
    trackSessionModel(ev?.model);
  });

  pi.on?.("thinking_level_select", (event) => {
    const ev = event as { level?: string };
    if (ev?.level) activeParentThinking = ev.level;
  });

  pi.on?.("session_shutdown", async (event, ctx) => {
    const reason = isObj(event) ? str(event.reason) : null;
    if (reason === "reload") return;

    const sessionId =
      ctx?.sessionManager?.getSessionId?.() ?? currentSessionId ?? "default";
    ctx?.ui?.setStatus?.("subagent", undefined);
    if (statusTicker) {
      clearInterval(statusTicker);
      statusTicker = undefined;
    }
    updateStatus = undefined;
    pendingExits = [];
    if (currentSessionId === sessionId) currentSessionId = null;
    await subagentManager.clearSession(sessionId);
  });
}

function formatSubagentExitMessage(task: BackgroundSubagentTask): string {
  const outcome =
    task.status === "cancelled"
      ? "was cancelled"
      : task.status === "paused"
        ? "was paused"
        : task.status === "failed"
          ? "failed"
          : "completed successfully";
  const logs = (task.progress?.runs ?? [])
    .map((run) => {
      const path = sessionLogPath(run);
      return path ? `- ${run.agent}: ${path}` : undefined;
    })
    .filter((line): line is string => Boolean(line));
  const logSection = logs.length ? `\n\nSession log${logs.length > 1 ? "s" : ""} (full model behaviour history):\n${logs.join("\n")}` : "";
  return `[Subagent Task ${task.id}] (${task.description}) ${outcome}.\n\n${task.output}${logSection}`;
}
