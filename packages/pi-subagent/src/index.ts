import { readFileSync, statSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { delimiter, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { StringDecoder } from "node:string_decoder";
import { homedir } from "node:os";
import { loadSubagentSettings, type SubagentSettings } from "./settings.js";
import { runSubagentCommand } from "./command.js";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

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
  model?: string;
  thinking?: string;
  tools?: string[];
  cwd?: string;
}

export interface SubagentInput {
  tasks?: (string | SubagentTaskItem)[];
  task?: string;
  chain?: boolean;
  async?: boolean;
  background?: boolean;
  // Legacy / fallback fields
  mode?: string;
  prompts?: string[];
  agent?: string;
  model?: string;
  thinking?: string;
  tools?: string[];
  cwd?: string;
}

export interface AgentConfig {
  model?: string;
  thinking?: string;
  tools?: string[];
  systemPrompt?: string;
}

export interface PiRunConfig {
  model?: string;
  thinking?: string;
  tools?: string[];
  cwd?: string;
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
const MAX_PARALLEL_TASKS = 16;
const ABORT_KILL_GRACE_MS = 1500;
const THROTTLE_MS = 300;
const MAX_FALLBACK_OUTPUT_CHARS = 8192;
let toolCallCounter = 0;

// ── State types ───────────────────────────────────────────────────────
export type RunStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";
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
  step?: number;
  status: RunStatus;
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
  mode: "concurrent" | "chain";
  startedAt: number;
  updatedAt: number;
  final: boolean;
  runs: RunState[];
}

// ── Native card handle registry ───────────────────────────────────────
interface NativeCardHandle {
  state: JsonObject;
  invalidate: () => void;
  updatedAt: number;
}

const MAX_NATIVE_CARDS = 20;
const nativeCards = new Map<string, NativeCardHandle>();
let activeSubagentToolCallId: string | null = null;

function rememberNativeCard(id: string, card: NativeCardHandle) {
  nativeCards.set(id, card);
  const active = activeSubagentToolCallId
    ? nativeCards.get(activeSubagentToolCallId)
    : undefined;
  if (!active || card.updatedAt >= active.updatedAt) {
    activeSubagentToolCallId = id;
  }
  for (const key of nativeCards.keys()) {
    if (nativeCards.size <= MAX_NATIVE_CARDS) break;
    if (key !== activeSubagentToolCallId) nativeCards.delete(key);
  }
}

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
  return failed
    ? "failed"
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

function renderRunBlock(
  lines: string[],
  d: ProgressDetails,
  run: RunState,
  expanded: boolean,
) {
  const step = run.step ? `step ${run.step} · ` : "";
  lines.push(`  - ${step}${runHeader(d, run)}`);
  const summary = behaviorSummary(run);
  if (summary) lines.push(`    › ${summaryText(summary)}`);
  const visibleTools = expanded ? run.tools.slice(-8) : run.tools.slice(-1);
  for (const t of visibleTools) {
    lines.push(`    ${toolIcon(t.status)} ${toolBrief(t)}`);
  }
  if (expanded && run.errorMessage) {
    lines.push(`    ✗ ${oneLine(run.errorMessage, 120)}`);
  }
}

function renderProgressCard(
  d: ProgressDetails,
  expanded: boolean,
  w: number,
): string[] {
  const r = activeRun(d);
  if (!r) return [];
  const spinner = ["◐", "◓", "◑", "◒"][Math.floor(Date.now() / 250) % 4]!;
  const icon = d.final
    ? d.runs.some((x) => x.status === "failed")
      ? "✗"
      : "✓"
    : spinner;
  const totalElapsed = fmtDur((d.final ? d.updatedAt : Date.now()) - d.startedAt);
  const modeLabel = d.mode === "chain" ? "pipeline" : d.runs.length > 1 ? "parallel" : "single";
  const lines: string[] = [
    `${icon} subagent ${modeLabel} · total ${totalElapsed}`,
  ];

  if (!expanded) {
    renderRunBlock(lines, d, r, false);
    lines.push("  Alt+O expand latest subagent card");
    return lines.map((l) => trunc(l, w));
  }

  for (const run of d.runs) renderRunBlock(lines, d, run, true);
  lines.push("  Alt+O collapse latest subagent card");
  const max = 48;
  const shown =
    lines.length > max
      ? [
          ...lines.slice(0, max - 1),
          `  … ${lines.length - max + 1} lines hidden`,
        ]
      : lines;
  return shown.map((l) => trunc(l, w));
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

function newRun(id: string, agent: string, prompt: string, step?: number): RunState {
  return {
    id,
    agent,
    prompt: trunc(prompt.replace(/\s+/g, " ").trim(), 120) || "(empty)",
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
  const sanitized = agentName.replace(/[\\/]/g, "").replace(/\.\./g, "").trim();
  if (!sanitized) return { config: {}, found: false };
  const baseName = sanitized.endsWith(".md") ? sanitized : `${sanitized}.md`;
  const agentHome = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  const candidates = [
    join(cwd, ".pi", "agents", baseName),
    join(agentHome, "agents", baseName),
    join(homedir(), ".pi", "agents", baseName),
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

  const inputModel = str(item.model);
  const roleModel = str(roleSettings?.model);
  const agentModel = str(agentCfg.model);
  const defaultModel = str(subagentSettings?.defaultModel);
  const rawModel = inputModel ?? roleModel ?? agentModel ?? defaultModel ?? str(inheritedModel);

  const inputSuffixThinking = normalize(inputModel?.match(suffixRe)?.[1]);
  const roleSuffixThinking = normalize(roleModel?.match(suffixRe)?.[1]);
  const agentSuffixThinking = normalize(agentModel?.match(suffixRe)?.[1]);
  const defaultSuffixThinking = normalize(defaultModel?.match(suffixRe)?.[1]);

  const baseModel = rawModel?.replace(suffixRe, "");
  const thinking =
    normalize(item.thinking) ??
    inputSuffixThinking ??
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

  if (baseModel && thinking && thinking !== "off") {
    return { model: `${baseModel}:${thinking}`, thinking, tools, cwd };
  }
  return { model: baseModel || rawModel || undefined, thinking, tools, cwd };
}

export function buildPiArgs(cfg: PiRunConfig): string[] {
  const args = ["--mode", "json", "-p", "--no-session"];
  if (cfg.model) {
    args.push(
      "--model",
      cfg.thinking && cfg.thinking !== "off" && !cfg.model.includes(":")
        ? `${cfg.model}:${cfg.thinking}`
        : cfg.model,
    );
  } else if (cfg.thinking && cfg.thinking !== "off") {
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
): Promise<{ output: string; failed: boolean }> {
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

    const abort = () => {
      aborted = true;
      cli.kill();
      killTimer = setTimeout(() => {
        if (!settled && cli.exitCode === null) cli.kill("SIGKILL");
      }, ABORT_KILL_GRACE_MS);
      killTimer?.unref?.();
    };

    const done = (v: { output: string; failed: boolean }) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      signal?.removeEventListener("abort", abort);
      emit();
      resolve(v);
    };

    signal?.addEventListener("abort", abort, { once: true });
    state.status = "running";
    state.startedAt = Date.now();
    emit();

    const processLine = (line: string) => {
      const evt = parseJsonEvent(line);
      if (evt && applyEvent(state, evt)) emit();
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
export function normalizeTasks(input: SubagentInput): {
  tasks: SubagentTaskItem[];
  isChain: boolean;
  isAsync: boolean;
} {
  const isChain = Boolean(input.chain || input.mode === "chain");
  const isAsync = Boolean(input.async || input.background);

  const rawList = input.tasks ?? input.prompts;
  const items: SubagentTaskItem[] = [];

  if (Array.isArray(rawList) && rawList.length > 0) {
    for (const item of rawList) {
      if (typeof item === "string") {
        const trimmed = item.trim();
        if (trimmed) {
          items.push({
            task: trimmed,
            agent: input.agent,
            model: input.model,
            thinking: input.thinking,
            tools: input.tools,
            cwd: input.cwd,
          });
        }
      } else if (item && typeof item === "object") {
        const t = String(item.task || "").trim();
        if (t) {
          items.push({
            task: t,
            agent: item.agent ?? input.agent,
            model: item.model ?? input.model,
            thinking: item.thinking ?? input.thinking,
            tools: item.tools ?? input.tools,
            cwd: item.cwd ?? input.cwd,
          });
        }
      }
    }
  }

  // Fallback to single task if tasks array was empty or omitted
  if (items.length === 0) {
    const single = String(input.task || "").trim();
    if (single) {
      items.push({
        task: single,
        agent: input.agent,
        model: input.model,
        thinking: input.thinking,
        tools: input.tools,
        cwd: input.cwd,
      });
    }
  }

  return { tasks: items, isChain, isAsync };
}

// ── Background Manager ────────────────────────────────────────────────
export interface BackgroundSubagentTask {
  id: string;
  parentSessionId: string;
  description: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  output: string;
  startedAt: number;
  finishedAt?: number;
  controller: AbortController;
  notifyOnExit: boolean;
  done: Promise<void>;
}

export class SubagentBackgroundManager {
  private readonly tasks = new Map<string, BackgroundSubagentTask>();
  private onExit?: (task: BackgroundSubagentTask) => void;
  private onChange?: () => void;

  init(onExit: (task: BackgroundSubagentTask) => void, onChange?: () => void): void {
    this.onExit = onExit;
    this.onChange = onChange;
  }

  register(task: BackgroundSubagentTask): void {
    this.tasks.set(task.id, task);
    this.emitChange();
  }

  complete(id: string, output: string, failed: boolean, cancelled = false): void {
    const t = this.tasks.get(id);
    if (!t) return;
    t.status = cancelled ? "cancelled" : failed ? "failed" : "succeeded";
    t.output = output;
    t.finishedAt = Date.now();
    this.emitChange();
    if (t.notifyOnExit) {
      try {
        this.onExit?.(t);
      } catch {}
    }
  }

  list(parentSessionId: string): BackgroundSubagentTask[] {
    return Array.from(this.tasks.values()).filter((t) => t.parentSessionId === parentSessionId);
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
    await Promise.all(sessionTasks.map((t) => t.done.catch(() => {})));
    this.emitChange();
  }

  private emitChange(): void {
    try {
      this.onChange?.();
    } catch {}
  }
}

const SUBAGENT_MGR_KEY = Symbol.for("@bytetrue/pi-subagent.manager");
const globalStore = globalThis as unknown as Record<symbol, SubagentBackgroundManager | undefined>;
export const subagentManager: SubagentBackgroundManager =
  (globalStore[SUBAGENT_MGR_KEY] ??= new SubagentBackgroundManager());

// ── Orchestrator ──────────────────────────────────────────────────────
export async function runSubagent(
  cwd: string,
  input: SubagentInput,
  signal?: AbortSignal,
  onUpdate?: (r: PiToolResult) => void,
  inheritedThinking?: string,
  inheritedModel?: string,
): Promise<{ output: string; details: ProgressDetails; failed: boolean }> {
  const { tasks: taskItems, isChain } = normalizeTasks(input);
  if (taskItems.length === 0) {
    throw new Error("No task specified. Provide 'tasks' or 'task'.");
  }
  if (taskItems.length > MAX_PARALLEL_TASKS) {
    throw new Error(`Subagent supports at most ${MAX_PARALLEL_TASKS} tasks.`);
  }

  const subagentSettings = loadSubagentSettings(cwd, true);
  const startedAt = Date.now();
  const primaryAgent = taskItems[0]?.agent || "subagent";
  const details: ProgressDetails = {
    kind: "pi-subagent-progress",
    agent: primaryAgent,
    mode: isChain ? "chain" : "concurrent",
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

  const finish = (output: string, failed: boolean) => {
    closed = true;
    details.final = true;
    details.updatedAt = Date.now();
    return { output, details: cloneProgress(details), failed };
  };

  try {
    if (isChain) {
      let prev = "";
      let failed = false;
      for (let i = 0; i < taskItems.length; i++) {
        const item = taskItems[i]!;
        const role = item.agent || "subagent";
        const { config: agentCfg } = findAgentDefinition(cwd, item.agent);
        const runCfg = resolveRunCfg(
          item,
          agentCfg,
          inheritedThinking,
          inheritedModel,
          subagentSettings,
        );
        const rs = newRun(`${role}-${i + 1}`, role, item.task, i + 1);
        applyRunConfig(rs, runCfg);
        details.runs.push(rs);
        emit(true);

        const chainedPrompt = prev
          ? `${item.task}\n\n### Previous Step Output:\n${prev}`
          : item.task;
        const result = await runPi(
          cwd,
          buildSubagentPrompt(chainedPrompt, agentCfg),
          runCfg,
          rs,
          emit,
          signal,
        );
        prev = result.output;
        failed = failed || result.failed;
        if (result.failed) break;
      }
      return finish(prev, failed);
    }

    // Concurrent mode (single or parallel)
    details.runs = taskItems.map((item, i) => {
      const role = item.agent || "subagent";
      const { config: agentCfg } = findAgentDefinition(cwd, item.agent);
      const runCfg = resolveRunCfg(
        item,
        agentCfg,
        inheritedThinking,
        inheritedModel,
        subagentSettings,
      );
      const r = newRun(`${role}-${i + 1}`, role, item.task);
      applyRunConfig(r, runCfg);
      return r;
    });
    emit(true);

    const results = await Promise.all(
      taskItems.map((item, i) => {
        const { config: agentCfg } = findAgentDefinition(cwd, item.agent);
        const runCfg = resolveRunCfg(
          item,
          agentCfg,
          inheritedThinking,
          inheritedModel,
          subagentSettings,
        );
        return runPi(
          cwd,
          buildSubagentPrompt(item.task, agentCfg),
          runCfg,
          details.runs[i]!,
          emit,
          signal,
        );
      }),
    );

    if (results.length === 1) {
      return finish(results[0]!.output, results[0]!.failed);
    }

    const aggregated = results
      .map((r, i) => `### Task ${i + 1} (${taskItems[i]?.agent || "subagent"}):\n${r.output}`)
      .join("\n\n---\n\n");
    return finish(aggregated, results.some((r) => r.failed));
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
        details: batch.length === 1 ? first : batch,
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

  const toggleDetail = (ctx: PiExtensionContext) => {
    const id = activeSubagentToolCallId;
    const card = id ? nativeCards.get(id) : undefined;
    if (!card) {
      ctx.ui?.notify?.("No subagent card to toggle yet.", "warning");
      return;
    }
    card.state.localExpanded = card.state.localExpanded !== true;
    card.invalidate();
  };

  pi.registerShortcut?.("alt+o", {
    description: "Toggle latest subagent progress card details",
    handler: async (ctx: PiExtensionContext) => toggleDetail(ctx),
  });

  pi.registerTool?.({
    name: "subagent",
    label: "Subagent",
    description:
      "Execute tasks in isolated child agent sessions. Runs concurrently by default, or sequentially when chain is true. Supports background execution.",
    parameters: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          description: "List of subagent tasks to execute.",
          items: {
            type: "object",
            properties: {
              task: {
                type: "string",
                description: "The task prompt to execute (REQUIRED).",
              },
              agent: {
                type: "string",
                description: "Optional agent role name (e.g. 'reviewer', 'researcher').",
              },
              model: {
                type: "string",
                description: "Optional model override (e.g. 'gemini-3.7-flash', 'gpt-5:low').",
              },
              thinking: {
                type: "string",
                enum: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
                description: "Optional thinking level.",
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
            },
            required: ["task"],
          },
        },
        chain: {
          type: "boolean",
          description:
            "Optional. If true, runs tasks sequentially as a pipeline (output of step N is piped into step N+1). Default: false.",
        },
        async: {
          type: "boolean",
          description:
            "Optional. If true, runs in the background and notifies the main session when finished. Default: false.",
        },
      },
      required: ["tasks"],
    },
    execute: async (
      id: string,
      input: SubagentInput,
      signal?: AbortSignal,
      onUpdate?: (r: PiToolResult) => void,
      ctx?: PiExtensionContext,
    ) => {
      activeSubagentToolCallId = id;
      const cwd = process.cwd();
      const inheritedThinking = pi.getThinkingLevel?.();
      const inheritedModel =
        ctx?.model?.provider && ctx?.model?.id
          ? `${ctx.model.provider}/${ctx.model.id}`
          : undefined;

      const { tasks, isChain, isAsync } = normalizeTasks(input);
      if (tasks.length === 0) {
        throw new Error("No task specified. Provide 'tasks' with at least one task item.");
      }

      // Background asynchronous execution
      if (isAsync) {
        const taskId = `sub_${randomBytes(6).toString("hex")}`;
        const sessionId =
          ctx?.sessionManager?.getSessionId?.() ?? currentSessionId ?? "default";
        const taskController = new AbortController();

        const desc =
          tasks.length === 1
            ? trunc(tasks[0]!.task, 60)
            : `${tasks.length} tasks (${isChain ? "chain" : "parallel"})`;

        const bgTask: BackgroundSubagentTask = {
          id: taskId,
          parentSessionId: sessionId,
          description: desc,
          status: "running",
          output: "",
          startedAt: Date.now(),
          controller: taskController,
          notifyOnExit: true,
          done: Promise.resolve(),
        };

        const execution = runSubagent(
          cwd,
          input,
          taskController.signal,
          undefined,
          inheritedThinking,
          inheritedModel,
        )
          .then((res) => {
            subagentManager.complete(taskId, res.output, res.failed, taskController.signal.aborted);
          })
          .catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            subagentManager.complete(taskId, msg, true, taskController.signal.aborted);
          });

        bgTask.done = execution;
        subagentManager.register(bgTask);

        return {
          content: [
            {
              type: "text",
              text: `Subagent task started in background (ID: ${taskId}, ${tasks.length} task(s)). You will be notified automatically upon completion.`,
            },
          ],
          details: { id: taskId, status: "running", count: tasks.length, chain: isChain },
        };
      }

      // Foreground synchronous execution
      const result = await runSubagent(
        cwd,
        input,
        signal,
        onUpdate,
        inheritedThinking,
        inheritedModel,
      );

      return {
        content: [{ type: "text", text: result.output }],
        details: result.details,
      };
    },
    renderCall: () => ({
      render() {
        return [];
      },
      invalidate() {},
    }),
    renderResult: (
      result: PiToolResult,
      _opts?: { expanded?: boolean; isPartial?: boolean },
      _theme?: unknown,
      context?: unknown,
    ) => {
      const ctxObj = isObj(context) ? context : null;
      const toolCallId = str(ctxObj?.toolCallId);
      const state = isObj(ctxObj?.state) ? (ctxObj.state as JsonObject) : null;
      const invalidate =
        typeof ctxObj?.invalidate === "function"
          ? (ctxObj.invalidate as () => void)
          : null;
      const isProgress =
        isObj(result.details) &&
        result.details.kind === "pi-subagent-progress";
      if (toolCallId && state && invalidate) {
        const updatedAt = isProgress
          ? (result.details as ProgressDetails).updatedAt
          : Date.now();
        rememberNativeCard(toolCallId, { state, invalidate, updatedAt });
      }
      return {
        render(w: number) {
          if (isProgress) {
            const expanded = state?.localExpanded === true;
            return renderProgressCard(
              result.details as ProgressDetails,
              expanded,
              w,
            );
          }
          return [trunc(result.content?.[0]?.text ?? "(no output)", w)];
        },
        invalidate() {},
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
    const sessionId = ctx?.sessionManager?.getSessionId?.() ?? "default";
    currentSessionId = sessionId;
    updateStatus = () => {
      const running = subagentManager
        .list(sessionId)
        .filter((t) => t.status === "running").length;
      ctx?.ui?.setStatus?.("subagent", running === 0 ? undefined : `sub:${running}`);
    };
    updateStatus();
  });

  pi.on?.("session_shutdown", async (event, ctx) => {
    const reason = isObj(event) ? str(event.reason) : null;
    if (reason === "reload") return;

    const sessionId =
      ctx?.sessionManager?.getSessionId?.() ?? currentSessionId ?? "default";
    ctx?.ui?.setStatus?.("subagent", undefined);
    updateStatus = undefined;
    pendingExits = [];
    if (currentSessionId === sessionId) currentSessionId = null;
    await subagentManager.clearSession(sessionId);
    nativeCards.clear();
    activeSubagentToolCallId = null;
  });

  pi.on?.("tool_result", (event) => {
    const ev = event as { toolName?: string; details?: unknown };
    if (
      ev.toolName === "subagent" &&
      isObj(ev.details) &&
      ev.details.kind === "pi-subagent-progress" &&
      Array.isArray(ev.details.runs) &&
      ev.details.runs.some(
        (r) => isObj(r) && (r.status === "failed" || r.status === "cancelled"),
      )
    ) {
      return { isError: true };
    }
    return undefined;
  });
}

function formatSubagentExitMessage(task: BackgroundSubagentTask): string {
  const outcome =
    task.status === "cancelled"
      ? "was cancelled"
      : task.status === "failed"
        ? "failed"
        : "completed successfully";
  return `[Subagent Task ${task.id}] (${task.description}) ${outcome}.\n\n${task.output}`;
}
