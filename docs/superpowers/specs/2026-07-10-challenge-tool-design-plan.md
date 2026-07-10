# CHALLENGE Speaker Tool — Design & Implementation Plan

## Goal

Give speakers a dedicated tool for voicing doubt, skepticism, or outright
disagreement with what a co-host just said. `ONE_LINER`'s description
already gestures at "gentle challenges," but it's really about witty/
insightful single sentences in general — pushback is incidental, not the
point. `CHALLENGE` makes that its own tool, following the exact pattern of
the existing speaker tools (`src/agents/speaker-tools.ts`): a name in
`SpeakerAgentToolName`, a `{message, style}` tool definition, and a slot in
whichever turn contexts should offer it.

## Design decisions

- **Availability**: offered in both normal turns (`SpeakerAgent.speak()`) and
  interjection turns (`SpeakerAgent.interject()`).
- **Downstream effects**: none. `CHALLENGE` is just another tag on
  `Speech.tool`, like `ONE_LINER`/`QUOTE`. It doesn't force or bias who
  speaks next — `DirectorAgent` and `interjection-policy.ts` are unchanged.
- **Token budget**: no new constant. `CHALLENGE` inherits whichever budget
  applies to the call site — `SPEECH_MAX_TOKENS` (80) on a normal turn,
  `INTERJECTION_MAX_TOKENS` (30) during `interject()`.
- **Interjection tool subset**: `interject()` currently restricts its tools
  via `toLlmTools(SHORT_REACTION_TOOLS.slice(0, 2))` — an index-based slice
  into an array whose real purpose is driving the brevity nudge. Adding a
  3rd interjection tool means this index coupling has to go; replace it with
  an explicit, self-documenting `INTERJECTION_TOOLS` constant.
- **Brevity nudge**: `SHORT_REACTION_TOOLS` is left unchanged — `CHALLENGE`
  is *not* added to it. That list nudges the model toward brevity after a
  run of long `SPEAK` turns; `CHALLENGE` is about substance, not length, and
  isn't guaranteed to be short.

## Implementation steps

### 1. Tool definition — `src/agents/speaker-tools.ts`

- Add `CHALLENGE = "challenge"` to `SpeakerAgentToolName` (after
  `NEARLY_OUT_OF_TIME`, line ~10).
- Add an entry to `SPEAKER_TOOL_DEFINITIONS` (after the `NEARLY_OUT_OF_TIME`
  entry, line ~68):

  ```ts
  {
    name: SpeakerAgentToolName.CHALLENGE,
    toolDescription:
      "Push back on what the previous speaker just said — voice real doubt, skepticism, or outright disagreement. Use when you have a genuine reason to question their claim, not just to be contrarian. Distinct from ONE_LINER: this is about disputing a point, not making a clever observation.",
    styleDescription:
      "How you're pushing back. Include tone and delivery. Example: 'Skeptical, slightly incredulous, leaning into \"really?\"'",
  },
  ```

  No schema changes — `toLlmTools()` already builds every tool's
  `input_schema` from the shared `{message, style}` shape (line ~88-101).

- Replace the interjection tool subset. Delete the `.slice(0, 2)` usage at
  the call site (see step 2) and add, near `SHORT_REACTION_TOOLS`
  (line ~71-76):

  ```ts
  export const INTERJECTION_TOOLS: SpeakerAgentToolName[] = [
    SpeakerAgentToolName.INTERJECT,
    SpeakerAgentToolName.FILLER_COMMENT,
    SpeakerAgentToolName.CHALLENGE,
  ];
  ```

  `SHORT_REACTION_TOOLS` itself is untouched — still
  `[INTERJECT, FILLER_COMMENT, SHORT_QUESTION, ONE_LINER]`.

### 2. Interjection turns — `src/agents/SpeakerAgent.ts`

- Line ~99: change
  `toLlmTools(SHORT_REACTION_TOOLS.slice(0, 2))` → `toLlmTools(INTERJECTION_TOOLS)`.
- Update the import at the top of the file to bring in `INTERJECTION_TOOLS`
  alongside the existing `SHORT_REACTION_TOOLS` import (line ~12).

### 3. Tests

- New `src/agents/speaker-tools.test.ts` (no test file exists for this
  module yet):
  - `toLlmTools()` with no filter includes a `CHALLENGE` entry with the
    expected `{message, style}` schema (name/description present, both
    fields required).
  - `toLlmTools(INTERJECTION_TOOLS)` returns exactly the tools named
    `INTERJECT`, `FILLER_COMMENT`, `CHALLENGE`, in that order.
  - `SHORT_REACTION_TOOLS` does not contain `CHALLENGE`.
- Extend `src/agents/SpeakerAgent.test.ts`: add a case asserting
  `interject()` passes a tool list containing `CHALLENGE` to the mocked
  `callModelWithTools`, using the existing
  `vi.spyOn(agent as any, "callModelWithTools")` pattern already used there
  for `stopReason` threading.
- Run the full suite afterward to confirm the existing `speak()` full-tool-set
  and brevity-nudge tests still pass unchanged.

## Manual verification

1. `pnpm build` (or `tsc --noEmit`) to confirm the new enum member and
   constant compile cleanly through `toLlmTools`'s existing typing.
2. `pnpm test` — confirm the new `speaker-tools.test.ts` cases pass and no
   existing `SpeakerAgent`/`interjection-policy` test regresses.
3. Generate a short script end-to-end (`tweedy script generate ...` with an
   existing speaker/material set) and skim the persisted speeches for a
   `[challenge]`-tagged line to sanity-check the model actually picks the
   tool sensibly given its description (this is a probabilistic check, not
   a hard assertion — the model may simply not choose it in a short run).

## Out of scope

- No new policy module governing how often `CHALLENGE` fires — frequency is
  left entirely to the LLM's judgment via the tool description, same as
  every non-`INTERJECT` tool today.
- No change to `interjection-policy.ts`'s `shouldInterject` — whether an
  interjection happens at all is unrelated to which tool is chosen once it
  does.
- No forced or biased next-speaker selection when the last speech was a
  `CHALLENGE`.
