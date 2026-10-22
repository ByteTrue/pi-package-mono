# pi-goal

One durable objective per session. The agent keeps working on it turn after turn
until it declares completion with evidence — no more typing「继续」every three
minutes.

A small extension: a single TypeScript file, no npm package. It is the minimal
version of Codex's `/goal`: an objective, an automatic continuation at Pi's
settle boundary, and one tool that stops the loop. There is no task tree, no
dashboard, no token budget, no auditor agent.

## Install

Run the repo's installer and tick `pi-goal` in the menu — the command is in
[small-extensions → Install](../#install). It copies `pi-goal.ts` into
`~/.pi/agent/extensions/`.

Restart or reload Pi. Nothing to configure.

## Use

You do not have to write the objective yourself:

```text
把这项工作设成 goal，然后开始执行
set this as the goal and keep going until it's done
```

The agent drafts the objective from the conversation and calls `goal_start`, so
the goal it works against is the one it understands — end state, how success
will be verified, what must not regress. `goal_start` is offered in every
session and disappears once a goal is running, so it cannot silently replace one.

Or state it directly:

```text
/goal Reduce p95 checkout latency below 120 ms without breaking the test suite
```

Either way the objective goes into the system prompt as a `<goal>` section and
the agent starts working. When a turn ends, Pi asks the extension whether to
continue; an active goal answers yes with a one-line continuation message, so
the agent picks up the next step instead of stopping.

It stops when the agent calls `goal_done`:

```json
{ "summary": "p95 is 96 ms on the checkout benchmark", "evidence": "npm run bench → p95 96 ms; npm test → 214 passed" }
```

`evidence` is required and shown to you on completion, so "done" means a check
that was actually run, not a claim.

| Command | What it does |
| --- | --- |
| `goal_start` (tool) | The agent's own way in: it drafts the objective and starts the goal |
| `/goal <objective>` | Start (or replace) the session's goal and begin working |
| `/goal` `/goal status` | Show the objective, continuation count, and recorded evidence |
| `/goal pause` | Stop continuing (the goal stays for later) |
| `/goal resume` | Continue a paused goal now |
| `/goal clear` | Discard the goal |

### How the loop stays honest

Continuing is automatic, but it is not unconditional:

- **Continuation that produced only text → pause.** If an automatically started
  run made no tool call at all, the goal pauses instead of looping on pure talk
  (Codex's own anti-spin rule); `/goal resume` continues after you look at it.
  The check covers the whole run, not its last turn — every run ends with a
  text-only turn, so a last-turn test would pause on every continuation. A
  user-started run that answers in text is not held against the goal.
- **Interrupt or provider error → pause.** Escape and failed runs are not
  progress.
- **Queued user input → hold.** If you have already typed something, the
  continuation stays out of the way until that input has been handled.
- **`/goal pause`, `/goal clear`, or `goal_done` → stop.** The extension never
  continues a goal that is not active.
- **A running goal cannot be replaced by the model.** `goal_start` fails while a
  goal is active; the user decides with `/goal clear` or `/goal pause`.

### Scope and lifetime

One goal per session (a new `/goal` replaces the previous one). The state is
written to the session transcript, so resuming the session restores the
objective, its continuation count, and any recorded evidence — and `/tree`
navigation follows the branch you land on. The two tools never coexist:
`goal_start` is offered while no goal runs and `goal_done` while one does, so an
ordinary session sees only the short `goal_start` schema.

Use it for work with a durable objective and a checkable finish line. For a
one-off edit or a question, a normal prompt is still the right tool.

## Uninstall

Delete the file — it is the whole extension:

```bash
rm ~/.pi/agent/extensions/pi-goal.ts
```

Nothing else to clean up: it writes no config, and the session entries it left
behind are inert without the extension.

## How it works

`pi-goal.ts` is the entire runtime — one file, zero imports (the type-only
import disappears at load; tool parameters are hand-written JSON Schema):

```text
pi-goal.ts        command + tool + event hooks + default-export entry
pi-goal.test.ts   CI-only: the full test suite (never installed)
package.json      private, never published — exists only so workspace CI runs tests
```

| Surface | Detail |
| --- | --- |
| `/goal` command | Parses `status`/`pause`/`resume`/`clear` as control words; anything else is the objective |
| `goal_start` tool | Drafts + starts a goal; active only while no goal runs |
| `goal_done` tool | Registered but inactive until a goal is active; requires `summary` + `evidence` |
| `before_agent_start` | Adds the objective as a `<goal>` system section — inside the cached prefix, and it survives compaction |
| `agent_before_settle` | The loop: while active, appends one hidden continuation message and returns `continue: true` |
| `agent_start` / `tool_call` | Count whether the current segment did real work |
| `session_start` / `session_tree` | Restore the goal from the transcript branch |
| `agent_settled` | Releases the print/json-mode command handler once the run is over |
| footer status | `goal:active(N)` / `goal:paused` |

Implementing the loop at `agent_before_settle` (rather than with timers, idle
polling, or a `bash`-style tool) is what makes it exact: Pi calls it at the one
point where no automatic retry, compaction, or queued work remains, and its
documented contract is "append entries, request one more model request."

In print and json modes (`pi -p "/goal …"`), the command handler holds the
session open until the run settles; otherwise the process would exit mid-loop.
