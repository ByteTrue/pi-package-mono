/**
 * pi-goal — one durable objective per session; the agent keeps working on it
 * until it declares completion with evidence.
 *
 * A small-extension: shipped as this single file (no npm package, no build step) and
 * installed by scripts/install-small-extension.mjs into ~/.pi/agent/extensions/.
 * Zero runtime imports — the installed artifact is exactly this file; jiti loads
 * TypeScript directly (type-only imports disappear at load time). Tool parameters are
 * hand-written JSON Schema, like pi-ask-user.
 *
 * Why it exists: a long task otherwise pauses after every turn and the user restarts
 * it by hand ("继续", "继续推进", ...). Codex solved this with /goal; pi-goal is the
 * same three-part contract at ~250 lines instead of a task tree, an auditor, and a
 * dashboard:
 *
 *   1. `/goal <objective>` stores the objective and the rules in the session — the
 *      objective in a system-prompt section (survives compaction), the state in a
 *      session entry (survives resume).
 *   2. At Pi's final actionable boundary (`agent_before_settle`), while the goal is
 *      active, the extension appends one hidden continuation message and returns
 *      continue: true. That is the whole loop — no timers, no idle polling.
 *   3. The loop stops only when the model calls `goal_done` with evidence. Two guards
 *      keep it from spinning: a turn that called no tools pauses the goal (Codex's
 *      own suppression rule), and an aborted or failed run pauses it too.
 *
 * Surface: one command (`/goal` + status|pause|resume|clear), one tool (`goal_done`,
 * activated only while a goal is active), three event hooks (session_start /
 * session_tree restore, turn_start+tool_call+agent_before_settle drive the loop,
 * before_agent_start injects the goal section), and a footer status line.
 */
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";

/** Custom-entry tag holding the goal state; also the custom-message tag of continuations. */
export const GOAL_ENTRY = "pi-goal";
/** System-prompt section name carrying the objective while a goal is active. */
export const GOAL_SECTION = "goal";
/** Footer status key. */
export const STATUS_KEY = "pi-goal";
/** Stops the loop: declares the objective verifiably true. Active only while a goal runs. */
export const GOAL_DONE_TOOL = "goal_done";
/** Starts a goal the model drafted itself, so the user never has to phrase the objective. */
export const GOAL_START_TOOL = "goal_start";

export type GoalStatus = "active" | "paused" | "done";

export interface GoalRecord {
  /** What must be verifiably true for the goal to be complete. */
  objective: string;
  status: GoalStatus;
  /** Automatic continuation turns started so far. */
  runs: number;
  /** Set by goal_done: what was achieved. */
  summary?: string;
  /** Set by goal_done: the concrete checks that prove it. */
  evidence?: string;
  updatedAt: number;
}

export interface GoalDoneParams {
  summary?: string;
  evidence?: string;
}

export interface GoalStartParams {
  objective?: string;
}

export type GoalCommand =
  | { kind: "status" }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "clear" }
  | { kind: "start"; objective: string };

/**
 * `/goal` with no arguments reports; the four keywords are exact matches only, so
 * `/goal clear the cache` starts a goal instead of clearing one.
 */
export function parseGoalCommand(raw: string): GoalCommand {
  const text = raw.trim();
  if (!text) return { kind: "status" };
  const keyword = text.toLowerCase();
  if (keyword === "status" || keyword === "pause" || keyword === "resume" || keyword === "clear") {
    return { kind: keyword };
  }
  return { kind: "start", objective: text };
}

/** The instruction appended at every settle to start the next turn. Stable text so it
 * repeats verbatim in the transcript; the objective lives in the system section. */
export const CONTINUE_MESSAGE =
  "Continue the active goal: take the next concrete step now. " +
  "Do not stop to summarize progress or to ask whether to continue. " +
  "When the objective is verifiably true, call goal_done with the evidence; " +
  "if a decision only the user can make blocks you, stop and state the blocker.";

/** Sent by /goal resume, which has to wake an idle session. */
export const RESUME_MESSAGE = "Continue the goal from where it stopped.";

/** The system-prompt section. Constant while the goal is unchanged, so it stays inside
 * the cached prefix; no run counters here for exactly that reason. */
export function goalSection(goal: GoalRecord): string {
  return [
    `Active goal (this session): ${goal.objective}`,
    "",
    "This is a durable objective for this thread, not a one-turn request. Pi continues the run automatically after each turn: do not stop to ask whether to continue, and do not treat intermediate progress as the final answer.",
    "",
    "Work until the objective is verifiably true, then call goal_done with a summary and the evidence that proves it. Evidence must name something actually checked (a command and its result, a test that passed, a file that now exists), never a claim of intent.",
    "",
    "If a decision only the user can make blocks progress, ask it (ask_user when it offers options) and stop without further tool calls: the goal pauses and /goal resume continues it.",
  ].join("\n");
}

export function statusText(goal: GoalRecord | null): string | undefined {
  if (!goal || goal.status === "done") return undefined;
  return goal.status === "active" ? `goal:active(${goal.runs})` : "goal:paused";
}

export function describeGoal(goal: GoalRecord | null): string {
  if (!goal) return "No goal in this session. Start one with /goal <objective>.";
  const lines = [`Goal (${goal.status}): ${goal.objective}`, `Automatic continuations: ${goal.runs}`];
  if (goal.summary) lines.push(`Completion: ${goal.summary}`);
  if (goal.evidence) lines.push(`Evidence: ${goal.evidence}`);
  if (goal.status === "active") lines.push("Controls: /goal pause · /goal clear");
  if (goal.status === "paused") lines.push("Controls: /goal resume · /goal clear");
  return lines.join("\n");
}

interface SessionEntryLike {
  type?: string;
  customType?: string;
  data?: unknown;
}

function toGoalRecord(data: unknown): GoalRecord | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  const objective = typeof record.objective === "string" ? record.objective.trim() : "";
  const status = record.status;
  if (!objective) return null;
  if (status !== "active" && status !== "paused" && status !== "done") return null;
  return {
    objective,
    status,
    runs: typeof record.runs === "number" && Number.isFinite(record.runs) ? record.runs : 0,
    ...(typeof record.summary === "string" ? { summary: record.summary } : {}),
    ...(typeof record.evidence === "string" ? { evidence: record.evidence } : {}),
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : 0,
  };
}

/** Last written goal state wins: `data: null` is a cleared goal and stops the scan. */
export function readGoalRecord(entries: readonly SessionEntryLike[]): GoalRecord | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry || entry.type !== "custom" || entry.customType !== GOAL_ENTRY) continue;
    return toGoalRecord(entry.data);
  }
  return null;
}

export type SettleOutcome = "completed" | "aborted" | "error";

export interface SettleFacts {
  outcome: SettleOutcome;
  /** Whether the run that just settled was started by this extension's continuation. */
  isContinuation: boolean;
  /** Tool calls made anywhere in this run. */
  runUsedTools: boolean;
  /** User or other queued input already waiting behind this run. */
  hasQueuedInput: boolean;
}

export type SettleDecision =
  | { action: "continue" }
  | { action: "pause"; reason: string }
  | { action: "hold"; reason: string };

/**
 * The loop's only policy. Continue on a healthy run; pause when a *continuation* produced
 * only text (Codex's anti-spin rule), when the user interrupted, or when the provider
 * failed; stay out of the way when input is queued.
 *
 * The no-work test applies to continuation runs only, and covers the whole run rather
 * than its last turn: every run ends with a text-only turn (the model reports and stops),
 * so a last-turn test would pause on every single continuation. A user-started run that
 * answered a question without tools still lets the goal continue — the user asked, the
 * goal did not stall.
 */
export function settleDecision(goal: GoalRecord | null, facts: SettleFacts): SettleDecision {
  if (!goal || goal.status !== "active") return { action: "hold", reason: "no active goal" };
  if (facts.outcome === "aborted") return { action: "pause", reason: "the run was interrupted" };
  if (facts.outcome === "error") return { action: "pause", reason: "the run ended with an error" };
  if (facts.hasQueuedInput) return { action: "hold", reason: "user input is already queued" };
  if (facts.isContinuation && !facts.runUsedTools) return { action: "pause", reason: "the continuation called no tools" };
  return { action: "continue" };
}

// Hand-written plain JSON Schema (no TypeBox Kind symbols): this artifact must stay
// zero-runtime-import, and Pi's validator has a dedicated plain-schema path.
const goalDoneParameters = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      minLength: 1,
      description: "What was achieved, in one or two sentences.",
    },
    evidence: {
      type: "string",
      minLength: 1,
      description:
        "The concrete check that proves it: the command you ran and its result, the test that passed, the file or artifact that now exists.",
    },
  },
  required: ["summary", "evidence"],
  additionalProperties: false,
} as const;

// Same plain-schema constraint as goal_done. Deliberately one field: the model authors the
// objective, and outcome + verification + constraints read better as one sentence than as
// three boxes it has to fill with fragments.
const goalStartParameters = {
  type: "object",
  properties: {
    objective: {
      type: "string",
      minLength: 1,
      description:
        "The objective you drafted from the conversation: the end state that must become true, how it will be verified, and any constraint that must not regress.",
    },
  },
  required: ["objective"],
  additionalProperties: false,
} as const;

function toolText(text: string, isError = false): AgentToolResult<unknown> {
  return isError
    ? { content: [{ type: "text", text }], isError: true, details: undefined }
    : { content: [{ type: "text", text }], details: undefined };
}

export function registerGoal(pi: ExtensionAPI): void {
  let goal: GoalRecord | null = null;
  let runUsedTools = false;
  // Set when a continuation is injected, consumed by the next agent_start, so the settle
  // check can tell "a continuation produced only talk" from "the user asked a question".
  let continuationInjected = false;
  let runIsContinuation = false;

  const persist = () => pi.appendEntry(GOAL_ENTRY, goal);

  const publish = (ctx: ExtensionContext) => ctx.ui.setStatus(STATUS_KEY, statusText(goal));

  const setGoal = (ctx: ExtensionContext, next: GoalRecord | null) => {
    goal = next;
    persist();
    publish(ctx);
  };

  // The two tools are mutually exclusive by design: goal_done exists only while a goal runs
  // (so it cannot be mistaken for a general "I'm done" signal), and goal_start only while
  // none runs (so it cannot silently replace an active objective). Rewriting the set only
  // when it actually differs keeps unrelated loadout changes untouched.
  const syncTool = () => {
    const wanted = goal?.status === "active" ? GOAL_DONE_TOOL : GOAL_START_TOOL;
    const unwanted = goal?.status === "active" ? GOAL_START_TOOL : GOAL_DONE_TOOL;
    const current = pi.getActiveTools();
    if (current.includes(wanted) && !current.includes(unwanted)) return;
    pi.setActiveTools([...current.filter((name) => name !== unwanted), wanted]);
  };

  // Branch-aware: after /tree navigation the active branch decides which goal is real.
  const restore = (ctx: ExtensionContext) => {
    goal = readGoalRecord(ctx.sessionManager.getBranch());
    syncTool();
    publish(ctx);
  };

  const send = (ctx: ExtensionContext, text: string) => {
    if (ctx.isIdle()) pi.sendUserMessage(text);
    else pi.sendUserMessage(text, { deliverAs: "followUp" });
  };

  // Print and json modes are single-shot: the session is disposed as soon as the command's
  // prompt resolves, so a run started from here would be torn down mid-loop. Holding the
  // handler open until the run settles keeps `/goal` usable headlessly; TUI/RPC return at once.
  const settleWaiters: (() => void)[] = [];
  pi.on("agent_settled", async () => {
    for (const resolve of settleWaiters.splice(0)) resolve();
  });
  const startRun = async (ctx: ExtensionContext, text: string) => {
    send(ctx, text);
    if (ctx.mode !== "print" && ctx.mode !== "json") return;
    await new Promise<void>((resolve) => settleWaiters.push(resolve));
  };

  pi.registerCommand("goal", {
    description:
      "Hold one objective for this session and keep working until goal_done. /goal <objective> · /goal status|pause|resume|clear",
    handler: async (args, ctx) => {
      const command = parseGoalCommand(args);
      switch (command.kind) {
        case "status":
          ctx.ui.notify(describeGoal(goal), "info");
          return;
        case "pause": {
          if (!goal || goal.status !== "active") {
            ctx.ui.notify("No active goal to pause.", "warning");
            return;
          }
          setGoal(ctx, { ...goal, status: "paused", updatedAt: Date.now() });
          syncTool();
          ctx.ui.notify("Goal paused. /goal resume continues it.", "info");
          return;
        }
        case "resume": {
          if (!goal || goal.status !== "paused") {
            ctx.ui.notify(goal ? `Goal is ${goal.status}; nothing to resume.` : "No goal to resume.", "warning");
            return;
          }
          setGoal(ctx, { ...goal, status: "active", updatedAt: Date.now() });
          syncTool();
          ctx.ui.notify("Goal resumed.", "info");
          await startRun(ctx, RESUME_MESSAGE);
          return;
        }
        case "clear": {
          if (!goal) {
            ctx.ui.notify("No goal to clear.", "warning");
            return;
          }
          setGoal(ctx, null);
          syncTool();
          ctx.ui.notify("Goal cleared.", "info");
          return;
        }
        default: {
          setGoal(ctx, {
            objective: command.objective,
            status: "active",
            runs: 0,
            updatedAt: Date.now(),
          });
          syncTool();
          ctx.ui.notify(`Goal active: ${command.objective}`, "info");
          await startRun(ctx, command.objective);
        }
      }
    },
  });

  pi.registerTool({
    name: GOAL_START_TOOL,
    label: "Start Goal",
    description:
      "Turn the user's request into a durable session goal and start working on it across turns, without the user having to phrase the objective. Call it when the user asks to make something a goal (\"把这个设成 goal\", \"set this as the goal and go\", \"keep working on this until it is done\") or when they hand you an outcome that will obviously need many turns of investigation. Draft the objective yourself from the conversation: the end state that must become true, how success will be verified, and what must not regress — one or two sentences, no restating of the chat. Do not call it for a one-turn task, and do not call it to resume or change an existing goal: while a goal is active this tool fails on purpose.",
    promptSnippet: "Start a goal you drafted yourself when the user wants a durable objective.",
    promptGuidelines: [
      "When the user says to make something a goal but does not spell out the objective, draft it and call goal_start instead of asking them to write it: state the end state, the verification surface, and the constraint that must not regress",
      "Do not call goal_start for a single-turn task, and do not call it while a goal is already active — /goal clear or /goal pause first",
    ],
    parameters: goalStartParameters as unknown as TSchema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const input = params as GoalStartParams;
      const objective = (input.objective ?? "").trim();
      if (!objective) {
        return toolText("goal_start needs an objective: the end state that must become true.", true);
      }
      if (goal?.status === "active") {
        return toolText(
          `A goal is already active, so goal_start did nothing: ${goal.objective}
` +
            "Tell the user to run /goal clear (or /goal pause) first if they want a different goal.",
          true,
        );
      }
      // Tool set is switched at the settle boundary (never mid-batch, where sibling calls
      // of the same assistant message may still be in flight).
      setGoal(ctx, { objective, status: "active", runs: 0, updatedAt: Date.now() });
      ctx.ui.notify(`Goal active: ${objective}`, "info");
      return toolText(
        `Goal started: ${objective}\n` +
          "It is now a durable objective for this session: keep taking concrete steps, and call goal_done with evidence when it is verifiably true. Do not stop to ask whether to continue.",
      );
    },
  });

  pi.registerTool({
    name: GOAL_DONE_TOOL,
    label: "Complete Goal",
    description:
      "Mark the active session goal complete. Valid only while a goal set with /goal is active: it is the one signal that stops the automatic continuation loop. Call it only after checking that the objective is actually true, and pass the evidence you checked. Never use it to report progress or to stop early — if you are blocked on the user, stop without calling tools instead.",
    promptSnippet:
      "The active /goal objective is verified complete — the only way the goal loop stops.",
    promptGuidelines: [
      "Call goal_done only when the active goal's objective is verifiably true: summary says what was achieved, evidence names the concrete check (command and result, passing test, existing file or artifact)",
      "Do not call goal_done to report progress, to pause, or to stop early; a blocker for the user is reported by stopping without further tool calls",
    ],
    parameters: goalDoneParameters as unknown as TSchema,
    defaultActive: false,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const input = params as GoalDoneParams;
      if (!goal) {
        return toolText("No goal is active in this session; there is nothing to complete.", true);
      }
      if (goal.status === "done") {
        return toolText("This goal is already complete.", true);
      }
      const summary = (input.summary ?? "").trim();
      const evidence = (input.evidence ?? "").trim();
      if (!summary || !evidence) {
        return toolText(
          "goal_done needs both summary and evidence: say what was achieved and name the check that proves it.",
          true,
        );
      }
      setGoal(ctx, { ...goal, status: "done", summary, evidence, updatedAt: Date.now() });
      ctx.ui.notify(`Goal complete: ${summary}`, "info");
      return toolText(`Goal marked complete.\nSummary: ${summary}\nEvidence: ${evidence}`);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    restore(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    restore(ctx);
  });

  pi.on("agent_start", async () => {
    // One run = one segment: the user prompted, or a continuation was injected (each
    // continuation starts a new run). Both facts are per segment.
    runIsContinuation = continuationInjected;
    continuationInjected = false;
    runUsedTools = false;
  });

  pi.on("tool_call", async () => {
    runUsedTools = true;
  });

  pi.on("before_agent_start", async (event) => {
    if (goal?.status !== "active") return;
    event.systemPromptOptions.sections[GOAL_SECTION] = goalSection(goal);
  });

  pi.on("agent_before_settle", async (event, ctx) => {
    const decision = settleDecision(goal, {
      outcome: event.outcome,
      isContinuation: runIsContinuation,
      runUsedTools,
      hasQueuedInput: ctx.hasPendingMessages(),
    });
    // goal_done flipped the state during the run; withdraw the tool before the next
    // request is declared. Tool-set edits are safe here (between turns, not mid-batch).
    syncTool();
    if (decision.action === "hold") return;
    if (decision.action === "pause") {
      if (goal) setGoal(ctx, { ...goal, status: "paused", updatedAt: Date.now() });
      syncTool();
      ctx.ui.notify(`Goal paused: ${decision.reason}. /goal resume to continue.`, "warning");
      return;
    }
    if (!goal) return;
    setGoal(ctx, { ...goal, runs: goal.runs + 1, updatedAt: Date.now() });
    continuationInjected = true;
    return {
      entries: [
        ...event.entries,
        { type: "custom_message", customType: GOAL_ENTRY, content: CONTINUE_MESSAGE, display: false },
      ],
      continue: true,
    };
  });
}

export default function piGoalExtension(pi: ExtensionAPI): void {
  registerGoal(pi);
}
