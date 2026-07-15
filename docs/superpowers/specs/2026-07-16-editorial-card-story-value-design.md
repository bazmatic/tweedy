# Editorial Card `storyValue` Scoring — Design & Implementation Plan

## Problem

`MaterialPreparerAgent.prepare()` extracts 6-12 `EditorialCard`s from a flat
blob of raw material text (`MaterialPreparerAgent.ts:39`) with no signal
distinguishing a curated "hook" (e.g. a source's own "Fun / Podcast-Friendly
Angles" section) from a raw Methods/Results statistic. `EditorialCard` has no
interestingness/quality field — only `kind`, which is model-self-assigned
with no validation.

At selection time, both `DirectorAgent.createPodcastPlan()` (card listing at
`DirectorAgent.ts:128-136`) and `DirectorAgent.getEditorialSection()`
(`DirectorAgent.ts:896-923`) present cards in raw creation order.
`getEditorialSection` additionally hard-caps at `.slice(0, 20)`
(`DirectorAgent.ts:915`), so a boring card extracted early can permanently
crowd out a great hook extracted later. Concrete example: a raw amplitude
stat from a paper's Methods section ("Cordyceps militaris ... high amplitude
0.2mV") was surfaced to a speaker as a fact, while the same source material's
own curated "Fun / Podcast-Friendly Angles" section (bioluminescent fungi,
cross-mushroom signal synchronization, a *Last of Us* pop-culture hook) never
got used.

## Goal

Score every editorial card for storytelling value at extraction time, and use
that score to order (not filter) cards at both selection points, so the
consistently strongest material rises to the top instead of being an accident
of extraction order.

## Design decisions

- **New required field**: `storyValue: number` (1-10 integer) on
  `EditorialCard`, assigned by the extraction model. Measures how surprising,
  vivid, or emotionally engaging the card would sound spoken aloud to a
  general listener — independent of factual importance.
- **Rubric lives in the extraction prompt**, not in code: 9-10 = a hook you'd
  tell a friend at a party; 4-5 = true but flat; 1-3 = a raw data point. The
  prompt also instructs the model that if the source material contains an
  author-curated "highlights/angles/fun facts"-style section, its contents
  are a strong prior for 8-10 scores — a raw Methods/Results number should
  not outscore a hook the source itself already flagged as compelling.
- **Deprioritize, don't exclude**: low-scoring cards remain in
  `script.editorialCards` (a beat may genuinely need a plain factual/
  connective point) but sort to the bottom at both selection points. No hard
  threshold filtering.
- **Fallback path**: `MaterialPreparerAgent.createFallback()`
  (`MaterialPreparerAgent.ts:88-106`, used when the extraction model call
  fails) assigns a neutral default `storyValue: 5` since there's no model
  judgement available.
- **Out of scope**: no change to card count (still 6-12), no retroactive
  re-scoring of already-generated scripts/persisted materials, no change to
  `EditorialCardKind`, no change to `chooseNextSpeaker`'s other selection
  logic beyond the sort.

## Implementation steps

### 1. Type changes — `src/types/index.ts`

- Add `storyValue: number;` to the `EditorialCard` interface (~line 212-222),
  next to `kind`. Document it inline: "1-10; how surprising/vivid/engaging
  this would sound spoken aloud, not factual importance."

### 2. Schema changes — `src/agents/editorial-schemas.ts`

- Add to `preparedCardSchema` (line 4-24):
  ```ts
  storyValue: z
    .number()
    .int()
    .min(1)
    .max(10)
    .describe(
      "How surprising, vivid, or emotionally engaging this card would sound spoken aloud to a general listener (1-10). Not a measure of factual importance — a true-but-flat fact scores low even if essential."
    ),
  ```

### 3. Extraction prompt — `src/agents/MaterialPreparerAgent.ts`

- Extend the prompt in `prepare()` (line 31-39) with the rubric and the
  curated-section-priority instruction, e.g. appended after the existing
  "Do not force every card kind..." paragraph:

  > Score every card's `storyValue` from 1-10: how surprising, vivid or
  > emotionally engaging it would sound spoken aloud to a general listener —
  > not how factually important it is. 9-10 is a hook worth repeating at a
  > party; 4-5 is true but flat; 1-3 is a raw data point. If the source
  > material itself contains a curated section of highlights, fun facts, or
  > podcast-friendly angles, treat its contents as a strong prior for 8-10
  > scores — a raw statistic from a methods or results section should not
  > outscore a hook the source has already flagged as compelling.

- `toPreparedMaterial()` (line 61-79): map `card.storyValue` straight through
  onto the constructed `EditorialCard`.
- `createFallback()` (line 88-106): set `storyValue: 5` on the single
  fallback card.

### 4. Selection ordering — `src/agents/DirectorAgent.ts`

- `createPodcastPlan()` (line 125-136): two separate sorts are needed since
  `materialText` groups cards by material while `script.editorialCards` is a
  flat list read later by `getEditorialSection`:
  - Immediately after the `flatMap` (line 125-127), resort
    `this.script.editorialCards` descending by `storyValue` in place — this
    is the list `getEditorialSection` reads from on later turns.
  - In the `materialText` builder (line 128-136), sort each material's own
    `prepared.cards` descending by `storyValue` before the `.map` at line
    131-133, so within each material's listing the best cards appear first
    while materials themselves stay grouped in the prompt.
- `getEditorialSection()` (line 896-923): sort `cards` by `storyValue`
  descending before `.slice(0, 20)` (line 914-915), e.g.:
  ```ts
  const cards = [...(script.editorialCards ?? [])].sort(
    (a, b) => b.storyValue - a.storyValue
  );
  ```
  Already-introduced marking logic (line 916-920) is unchanged — it still
  runs per-card after sorting.

### 5. Tests

- `src/agents/MaterialPreparerAgent.test.ts` (create if it doesn't exist, or
  extend if it does): assert `toPreparedMaterial` passes `storyValue` through
  onto the resulting card, and that `createFallback` sets `storyValue: 5`.
- `src/agents/DirectorAgent.test.ts`:
  - `getEditorialSection`: given cards with mixed `storyValue`, assert the
    rendered card text lists them highest-`storyValue`-first, and that a
    21st-ranked-by-score card is excluded by the `.slice(0, 20)` cap instead
    of an arbitrary 21st-by-creation-order card.
  - `createPodcastPlan`: assert `script.editorialCards` ends up sorted
    descending by `storyValue` after the flatMap.

## Manual verification

1. `pnpm build` / `npx tsc --noEmit` — confirm the new required field
   compiles cleanly everywhere `EditorialCard` is constructed or consumed.
2. `pnpm test` — new and existing `MaterialPreparerAgent`/`DirectorAgent`
   tests pass.
3. Regenerate a script from `material/fungi-language-paper.md` end-to-end and
   check the persisted script's `editorialCards`/speeches for evidence that a
   "Fun / Podcast-Friendly Angles" hook (bioluminescence, cross-mushroom
   synchronization, or the pop-culture tie-in) was introduced instead of the
   raw amplitude/frequency statistic that surfaced in the original run — a
   probabilistic sanity check, not a hard assertion.

## Out of scope

- No UI/CLI surface for viewing or editing `storyValue` on existing cards.
- No migration for already-persisted `PreparedMaterial`/`EditorialCard` data
  written before this change (there is none — this pipeline is regenerated
  fresh per script per the note in `CLAUDE.md` about the RAG store).
- No change to how `chooseNextSpeaker` decides *whether* a card gets
  introduced, only the order candidates are presented in.
