# Resume generation for a prematurely-ended script

## Problem

`ScriptService.generateScript` always starts a brand-new `PodcastScript` from
an empty `speeches` array (`src/services/ScriptService.ts:107`). There is no
way to pick a script back up if generation stops before reaching its target
length.

This bit us in practice: a Kimi (Moonshot) run hit that provider's daily
token quota partway through a 90-turn, 1200-second episode. The Mastra
episode workflow doesn't surface that as a failure — `proposeTurn`'s
surrounding `try/catch` in `src/mastra/episode-workflow.ts:700-732` treats a
thrown error from turn selection as a cue to immediately force a closing
sequence (`forceClosingTurn(state, "turn selection failed")`) rather than
aborting the run. The CLI printed `✓ Script generated successfully`, but the
episode was 30 speeches long instead of ~150 — a fabricated ending stapled
onto real content.

Out of scope for this change: true crash/interrupt resume (process killed,
machine restarts mid-run). Mastra's workflow snapshots are already being
persisted (`shouldPersistSnapshot: () => true` in `src/mastra/episode-workflow.ts`)
and `run.resume()` is proven to work generically
(`src/mastra/workflow-resume.test.ts`), but no step in the real episode
workflow ever calls `suspend()`, so there's no snapshot to resume from today.
Wiring that up is a separate follow-up. This change also does not touch the
`legacy` conversation engine — it has no `productionOutcome`/completion-reason
tracking to detect a forced-early-close, and no workflow durability to build
on.

## Detecting a resumable script

A script is eligible for resume when:

- its `conversationRun.engine === "mastra"`, and
- `script.productionOutcome?.completionReason === "turn_selection_failed"`

That completion reason is the one and only signal produced by the
catch-and-force-close path above (`reason.replace(/ /g, "_")` in
`MastraScriptWorkflowRunner.ts`'s `forceClosingTurn` dependency, called with
`"turn selection failed"`). Every other completion reason (`"duration limit"`,
`"turn limit"`, `"natural conclusion"`, `"director requested close"`,
`"closing phase"`) reflects the episode reaching its real target or the
director choosing to wrap up — those scripts are not resume candidates.

`ScriptService.assertCanResume(scriptId, requestedEngine)` already exists
(`src/services/ScriptService.ts:162`) but today only checks engine/flowVersion
compatibility via `assertConversationRunCompatible`. Extend it to also load
the script's `productionOutcome` and throw a clear, distinct error for each
ineligible case:

- no `conversationRun` metadata → "Script has no resumable conversation
  workflow metadata" (existing behavior, unchanged)
- `conversationRun.engine !== "mastra"` → "Resume is not supported for the
  legacy engine"
- `productionOutcome?.completionReason !== "turn_selection_failed"` → "Script
  completed normally — nothing to resume"

## Data model changes

### Incremental `Script` persistence

Today `ScriptService.generateScript` only calls `saveScript` once, after
`engine.generate` resolves (`src/services/ScriptService.ts:151-152`).
Individual `Speech` records are written turn-by-turn via `persistSpeech`
during the run, but the parent `Script` record — the thing `script resume
<id>` needs to target — doesn't exist until the very end. If the process
had hard-crashed instead of gracefully force-closing, there would be no
script to resume at all.

Change `generateScript` to:

1. Build the initial `script` object (as today) and call `saveScript`
   immediately, before invoking `engine.generate`, so the record exists with
   an empty `speechIds` from the start.
2. Pass a `onSpeechPersisted` callback into the engine request
   (`ConversationGenerationRequest`) that the Mastra runner invokes after
   each `persistSpeech` call, updating the saved record's `speechIds` (via
   the existing `scriptRepository.update`, following whatever shape
   `saveScript` already uses).

This is the same mechanism phase 2 (crash resume) will need, so it's built
once here rather than as a throwaway for this change alone.

### Persist original generation limits

`GenerateScriptParams.maxDuration`/`maxTurns` are used to build the script
but never saved on the record. Add `maxDuration`/`maxTurns` to the
`ScriptRecord`/`saveScript` payload so `script resume` has a sane default
target without requiring the user to re-specify them.

### Mark closing-sequence speeches

`ClosingSequencePolicy.nextTurn` (`src/agents/ClosingSequencePolicy.ts`)
produces up to three turns per closing sequence — `reflection`,
`co_host_response` (only with 2+ speakers), `sign_off` — but nothing on the
persisted `Speech` record says which (if any) closing stage a turn belongs
to. Only the final `sign_off` turn is identifiable after the fact, via
`tool === SpeakerAgentToolName.CLOSING_STATEMENT`.

Add an optional `closingStage?: "reflection" | "co_host_response" |
"sign_off"` field to `Speech` and to the persisted record shape
(`persistSpeech` in `ScriptService.ts`), set from the `ClosingStage` that
`MastraScriptWorkflowRunner`'s `forceClosingTurn` dependency already computes
via `closing.nextTurn(script, state.closingCursor)`. This lets resume
identify and strip exactly the fabricated closing sequence, rather than
guessing by counting back a fixed number of turns (which would be wrong if
an interjection landed in between, or if a run force-closed with 0, 1, 2, or
3 closing turns already emitted).

## CLI surface

New subcommand:

```
tweedy script resume <id> [--provider <name>] [--max-duration <secs>] [--max-turns <n>]
```

- `--provider` is new — not currently exposed on `script generate` either
  (provider selection today is only via the `DEFAULT_AI_PROVIDER` env var
  read in `src/utils/config.ts`). Threads through to
  `GenerateScriptParams.provider`, which `BaseAgent` already accepts
  (`src/agents/BaseAgent.ts:330`) but nothing currently sets from the CLI.
  Optional; defaults to the configured `DEFAULT_AI_PROVIDER` as before. This
  is exactly what tonight's incident needed — continuing generation on a
  different provider than the one that ran out of quota.
- `--max-duration`/`--max-turns` optional overrides of the original target;
  default to the values persisted on the script record (see above).

## Resume execution flow

Add `resume()` to the `ConversationWorkflowEngine` interface
(`src/services/conversation-engine.ts`), parallel to `generate()`. The
`LegacyConversationWorkflowEngine` implementation throws
"resume is not supported for the legacy engine" — `assertCanResume` should
already prevent reaching this, but the engine-level guard stays as a
backstop against future callers that skip the service-level check.

`MastraConversationWorkflowEngine.resume()` (backed by a new
`MastraScriptWorkflowRunner.resume()`):

1. Load the full script via the existing `loadScriptFromRecord`.
2. Walk `script.speeches` backward from the end while each has a
   `closingStage` set, collecting them; stop at the first speech without one.
   Delete those `Speech` records via `speechRepository.delete` and drop them
   from `script.speeches`/the record's `speechIds`.
3. Clear `script.productionOutcome`, and clear `omitted`/`omissionReason` on
   any `discussionPoints` that carry the stale omission reason set by
   `markRemainingPointsOmitted` during the fake close (so the director
   doesn't treat those points as already handled).
4. Re-run the same Mastra workflow machinery as `run()`
   (`workflow.createRun({ runId: workflowRunId })` / `run.start(...)`) reusing
   the **same** `workflowRunId` from `script.conversationRun.workflowRunId`,
   with `script.speeches` pre-populated as the starting state. Already-
   generated turns' idempotency keys (`title/workflowRunId/turnIndex/tool`)
   collide harmlessly against `speechRepository.createOrReturn`; new turns
   continue from `state.turnsUsed = script.speeches.length`.
5. Apply the `--max-duration`/`--max-turns`/`--provider` overrides (or the
   persisted originals) the same way a fresh `generate()` call would.
6. Save via the same incremental-save path introduced above — no separate
   "final save" special-casing needed since the record is kept up to date
   throughout.

## Edge cases

- Resuming a script that itself fails again (still rate-limited, etc.) just
  leaves it in the same resumable state (`turn_selection_failed` again) —
  no special handling needed, the user can retry `script resume` once the
  underlying provider issue clears.
- No locking around concurrent resume of the same script id — out of scope
  for a single-user local CLI tool.
- A script force-closed while still in the `"opening"` phase after 5
  consecutive rejected turns (`episode-workflow.ts:662-669`) throws instead
  of going through `forceClosingTurn` at all — that path produces a thrown
  error from `engine.generate`, not a `"success"` result, so
  `productionOutcome` is never set and this script type is simply not
  resumable by this feature (it was never saved as `complete` in the first
  place, and with incremental persistence in place, will have partial
  `speechIds` visible via `script show` but no `productionOutcome` to trigger
  the resume-eligibility check — `assertCanResume` will reject it via the
  "nothing to resume" branch, which is accurate: this is a different failure
  mode than the one this feature targets).

## Testing

- Unit test for the closing-stage stripping logic (pure function over a
  fixture `Speech[]` array): 0/1/2/3 trailing closing turns, and a case with
  a non-closing interjection in between to confirm the walk-backward stops
  correctly.
- Unit test extending `ScriptService`'s existing `assertCanResume` coverage
  (if any — otherwise new) for each of the four eligibility branches.
- Integration-style test on `MastraScriptWorkflowRunner`, mirroring the
  pattern in `MastraScriptWorkflowRunner.test.ts`: run a fake director/speaker
  setup that force-closes early via a thrown error, then call `resume()` and
  assert it continues to natural completion without duplicating the
  already-persisted speeches (same duplication check as
  `workflow-resume.test.ts`'s `IdempotentSpeechFake`).
