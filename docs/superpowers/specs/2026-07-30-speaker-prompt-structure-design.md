# Speaker Prompt Structure & Retry-Feedback Segregation — Design

## Problem

`SpeakerAgent.generateSpeech`'s prompt (`src/agents/SpeakerAgent.ts:405-439`)
mixes several conceptually distinct inputs — persona, conversation history,
director guidance, turn brief, editorial cards, retry/rejection feedback, and
~25 unrelated authoring rules (accessibility, length limits, provider caps,
anti-repetition, formatting) — into one run-on paragraph with no clear
separation between them.

Two concrete problems fall out of this:

1. **Retry feedback is mislabeled as director guidance.** When
   `MastraScriptWorkflowRunner.repairTurn` (`MastraScriptWorkflowRunner.ts:286-318`)
   handles a rejected candidate, it appends the same `retryGuidance` string to
   *both* `direction` (rendered in the prompt as "Director's guidance: ...")
   and `turnBrief.goal` (rendered as "Goal: ..."). The rejection note ends up
   printed twice under two different labels, and it's presented as if it came
   from the director rather than from review of the speaker's own prior
   attempt at this turn.
2. **The trailing rules paragraph is an instruction dump, not prose.** Unlike
   the persona/history/context sections — which genuinely read as a scene and
   benefit from natural framing — the rules block is already a checklist of
   independent directives with no narrative content to lose. Leaving it as one
   undifferentiated paragraph gets none of prose's benefit and makes the
   authoring code (one large template literal) hard to maintain.

## Goal

Restructure the non-narrative parts of the prompt (director guidance, turn
brief, editorial cards, retry feedback, and the rules block) into clearly
labeled, non-overlapping sections, and stop the repair path from duplicating
rejection feedback across two differently-labeled fields — while keeping
persona and conversation history as natural prose, since that part is scene-
setting the model should keep writing naturally from.

## Design decisions

- **New field, not overloaded existing ones.** Add `retryFeedback?: string` to
  `SpeakerTurnOptions` (`src/types/index.ts`). `direction` and `turnBrief.goal`
  are left untouched by the repair path — they keep whatever the director
  originally set.
- **Quote the rejected attempt.** `MastraScriptWorkflowRunner.repairTurn`
  already has access to the previously generated candidate via
  `generatedSpeeches.get(keyFor(proposal))` (the same map `generateCandidate`
  and `reviewCandidate` populate/read, `MastraScriptWorkflowRunner.ts:342-392`).
  Use `.message` from that lookup to quote the rejected text verbatim in
  `retryFeedback`, so the speaker can see exactly what to tweak instead of
  re-deriving its prior attempt from a bare rejection reason.
- **Explicit "your previous attempt" framing.** `retryFeedback` reads as:
  > Your previous attempt at this turn was rejected: `<reason>`. What you
  > said: "`<message>`". Revise to fix that specific problem while keeping
  > the same goal — don't just reword it.

  (Preserve the existing "recurring rejection" variant's stronger wording —
  "this same problem has now failed N attempts in a row... change what
  information you lead with or how you frame it" — as an alternate template
  when `findRecurringRejection` matches, same as today's `retryGuidance`
  branch.) The explicit "your previous attempt" phrasing matters: a bare
  "Reviewer feedback:" label doesn't tell the model this is about its own
  last output for this same turn, not some in-universe critic.
- **Labeled sections, not JSON.** Director guidance, turn brief, editorial
  cards, and retry feedback each get their own clearly headed paragraph (e.g.
  "Director's guidance:", "Your previous attempt:", "Turn brief:", "Prepared
  editorial material:") instead of being concatenated. This is plain text
  with clear delimiters, not a literal JSON blob — lower risk to the model's
  natural phrasing than embedding real JSON, while still giving the
  conceptual segregation this design is after.
- **Group the rules block under sub-headers.** Split the trailing
  instructions into: **Audience & Accessibility**, **Length & Delivery**
  (length guidance + provider cap note), **Conversational Style**
  (novelty/repetition avoidance, natural speech style, expertise nudge), and
  **Formatting** (em dash / no markdown / no stage directions). Same content
  as today, reorganized under headers instead of one paragraph.
- **Extract section builders.** Give `SpeakerAgent` small private methods
  (e.g. `buildRetryFeedbackSection()`, `buildRulesSection()`) that each
  return a string, assembled into the final prompt — improves the
  maintainability of the authoring code alongside the prompt's own clarity.
- **Persona, conversation history, and the analogy/recap intro stay prose,
  unchanged.** These are scene-setting content, not instructions — no
  restructuring risk there.
- **Out of scope:**
  - DirectorAgent's and TurnReviewerAgent's own prompts are untouched.
  - `toTurnBrief`'s `goal: input.goal ?? direction` default
    (`DirectorAgent.ts:1807`) is left as-is; `direction` and `turnBrief.goal`
    can still legitimately match when the director didn't set an explicit
    distinct goal. Only the repair-path *compounding* of duplicate text is
    fixed.
  - `ScriptService` (the legacy, non-Mastra engine) has no equivalent repair
    loop — on rejection it discards the speech and asks the director for a
    fresh turn instead (`ScriptService.ts:552-565`) — so no changes are
    needed there.

## Implementation steps

### 1. Type changes — `src/types/index.ts`

- Add `retryFeedback?: string;` to `SpeakerTurnOptions`, next to
  `episodeRecap`.

### 2. Repair-path plumbing — `src/services/MastraScriptWorkflowRunner.ts`

- In `repairTurn` (`MastraScriptWorkflowRunner.ts:286-318`):
  - Look up the rejected message: `generatedSpeeches.get(keyFor(proposal))?.message`.
  - Replace the two `retryGuidance` template branches with equivalents that
    interpolate the quoted message, e.g.:
    ```ts
    const rejectedMessage = generatedSpeeches.get(keyFor(proposal))?.message;
    const retryFeedback =
      recurring && recurring.reason === rejectionReason
        ? `Your previous attempt at this turn was rejected: ${rejectionReason}. What you said: "${rejectedMessage}". This same problem has now failed ${recurring.occurrences} attempts in a row, each time in different wording — rephrasing alone has not worked. Make a substantively different fix: change what information you lead with or how you frame it, not just the phrasing.`
        : `Your previous attempt at this turn was rejected: ${rejectionReason}. What you said: "${rejectedMessage}". Revise to fix that specific problem while keeping the same goal — don't just reword it.`;
    ```
  - Stop appending anything to `direction` or `turnBrief.goal`. Instead carry
    `retryFeedback` on the stored `selected` turn: add an optional
    `retryFeedback?: string` field to the local `SelectedTurn` interface
    (`MastraScriptWorkflowRunner.ts:46`) so `generateCandidate` can read it
    back out.
- In `generateCandidate` (`MastraScriptWorkflowRunner.ts:342-382`): pass
  `retryFeedback: selected.retryFeedback` into the `speak(script, direction,
  {...})` options object.

### 3. Prompt restructuring — `src/agents/SpeakerAgent.ts`

- Destructure `retryFeedback` out of `options` in `speak()`/`generateSpeech()`
  alongside the other fields.
- Add `buildRetryFeedbackSection(retryFeedback?: string)`: returns `""` when
  absent, otherwise the labeled paragraph described above.
- Add `buildRulesSection(...)`: assembles the existing rules content (today's
  trailing paragraph in the template literal, `SpeakerAgent.ts:439`) under
  the four sub-headers, preserving every existing instruction's wording
  verbatim — this is a re-grouping, not a rewrite of the rules themselves.
- Update the main template literal to:
  - Insert the director's guidance / retry feedback / turn brief / editorial
    section as separate labeled paragraphs (mostly reusing
    `getEditorialContext` as-is; just no longer folding retry text into
    `direction`).
  - Call `buildRulesSection()` in place of today's inline rules paragraph.

### 4. Tests

- `src/services/MastraScriptWorkflowRunner.test.ts`: extend/add a repair-path
  test asserting:
  - `direction` and `turnBrief.goal` passed to a repaired `speak()` call are
    unchanged from the original selection (no appended text).
  - The `retryFeedback` option passed to the repaired `speak()` call contains
    both the rejection reason and the quoted previous message.
- `src/agents/SpeakerAgent.test.ts`:
  - New test: when `retryFeedback` is provided, the prompt contains a
    distinctly labeled section with the quoted previous attempt, and does
    *not* duplicate that text elsewhere in the prompt.
  - New test: rules-section content is grouped under the expected headers
    (spot-check a couple of rules landing under the right header).
  - Existing `.toContain(...)` assertions should keep passing since rule
    wording is preserved; update any that assumed the old single-paragraph
    layout if they break on the header insertions.

## Manual verification

1. `npx tsc --noEmit` and `pnpm test` — full suite green.
2. Trigger a rejection/repair cycle in a real or test run and inspect the
   resulting prompt (e.g. via the same kind of transcript dump used to spot
   this problem) to confirm the retry feedback appears once, quotes the
   rejected line, and reads clearly as feedback on the speaker's own prior
   attempt.

## Out of scope

- DirectorAgent / TurnReviewerAgent prompt structure.
- Collapsing `direction`/`turnBrief.goal` when they happen to match outside
  the repair path.
- Any JSON-literal prompt format — sections stay as labeled prose.
- ScriptService's legacy (non-Mastra) engine.
