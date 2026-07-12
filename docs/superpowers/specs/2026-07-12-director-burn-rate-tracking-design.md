# Director burn-rate / discussion-point tracking

## Problem

The director currently only tracks progress against turn count and estimated
elapsed speaking time (`DirectorAgent.calculateProgress`). It has no notion of
*how much material has actually been covered*. The podcast plan
(`createPodcastPlan`) is free-form prose — "main discussion points" is just a
paragraph, not a structured, trackable list. As a result episodes routinely
run out of turns/time with material still uncovered, because the director has
no signal that it's falling behind on content, only on the clock.

## Goals

- Give the director a structured list of discussion points to track.
- Track which points have been covered as the conversation proceeds.
- Compute a velocity signal (points covered per minute vs. points needed per
  minute to finish in the remaining time) and use it to steer the director's
  prompts more aggressively than time-based pacing alone.
- Let the director compress multiple remaining points into a single turn via
  a new speaker tool when behind pace.
- Persist the point list and coverage state on the script, and log
  turn-by-turn and end-of-episode visibility for debugging.

## Non-goals

- No explicit mid-episode "cut this point" mechanic. If a point never gets
  covered, that's just reflected in the final log/persisted state — nothing
  forces the director to make a cut decision.
- No change to how materials are chunked/ingested; points are derived by the
  director's plan-creation call, not extracted from materials directly.

## Data model

### `DiscussionPoint` (new type)

```ts
interface DiscussionPoint {
  id: string;        // "p1", "p2", ... assigned when the plan is created
  text: string;       // short description of the point
  covered: boolean;
  coveredAtTurn?: number; // turn index it was marked covered on
}
```

### `PodcastScript`

Gains a new field:

```ts
discussionPoints: DiscussionPoint[];
```

Persisted directly in the script's JSON record (`ScriptRepository` stores
plain JSON — no new repository needed), alongside `title`/`description`.
`loadScriptFromRecord` reads it back; defaults to `[]` for scripts saved
before this change.

## Plan creation changes

`DirectorAgent.createPodcastPlan()` switches from a plain `callModel` text
completion to a tool-forced call (new tool `create_podcast_plan`, following
the same `callModelForToolInput` pattern used by `chooseNextSpeaker`). The
tool returns:

```ts
{
  narrative: string;        // the existing free-text plan
  points: string[];          // discussion point descriptions, in order
}
```

`DirectorAgent` assigns local ids (`p1`, `p2`, ...) to `points` and builds its
internal `DiscussionPoint[]` state (all `covered: false` initially). The
narrative text continues to be used exactly as today (included in the
`chooseNextSpeaker` prompt as `Podcast Plan: ...`).

## Coverage tracking

No separate LLM call. The existing `select_next_speaker` tool schema
(`director-tools.ts`) gains an optional field:

```ts
coveredPointIds?: string[]; // ids of currently-open points the last speech(es) addressed
```

Each time `chooseNextSpeaker` runs, the prompt already includes the last 5
speeches. The director marks `coveredPointIds` for whichever open points were
addressed by the speech(es) since the last check, in the same response that
picks the next speaker and direction — no extra LLM round-trip. `DirectorAgent`
applies these to its point state (`covered = true`, `coveredAtTurn =
this.turnsUsed`) before building the next prompt. The prompt should list
currently open points explicitly (id + text) so the director has something
concrete to check off, e.g.:

```
Open points:
- p2: the 1990s regulatory change
- p4: how the pricing model shifted post-2010
```

## Velocity calculation

New private method on `DirectorAgent`, computed each `chooseNextSpeaker` call:

- `elapsedMinutes = estimateElapsedSeconds(script) / 60`
- `remainingMinutes = Math.max((maxDuration - estimateElapsedSeconds(script)) / 60, 0.1)` (epsilon floor to avoid divide-by-zero near the end)
- `coveredCount` / `openCount` from the point state
- `actualPace = coveredCount / Math.max(elapsedMinutes, 0.1)`
- `neededPace = openCount / remainingMinutes`
- `paceStatus`: `'behind'` if `actualPace < neededPace * 0.9`, `'ahead'` if
  `actualPace > neededPace * 1.25`, else `'on-pace'`

This only activates once there's at least one point and `elapsedMinutes > 0`
(first turn has no signal yet — falls back to today's time/turn-based notes
only).

## Prompt injection

`getWrapUpNote` (or a new sibling method, `getVelocityNote`) adds pace-aware
guidance layered on top of the existing time-based notes:

- `behind`: lists the open points and instructs the director to move faster —
  direct the next speaker to cover multiple remaining points concisely, and
  explicitly suggests using the new summarize tool if there are 2+ open
  points and time is short.
- `on-pace` / `ahead`: no extra note (today's time-based notes still apply
  independently).

## New `SUMMARIZE` speaker tool

Added to `speaker-tools.ts`:

```ts
SpeakerAgentToolName.SUMMARIZE = "summarize"
```

Tool description: deliver a compact recap that briefly touches each of
several named points (one clause per point), rather than one idea per turn
like `SPEAK`. Included in the default tool set (available to the model like
any other tool) but the director's direction text is what actually prompts
its use when behind pace.

Wiring, mirroring the existing `forceNearlyOutOfTime` pattern:

- `chooseNextSpeaker` returns an additional `requestSummary: boolean` (true
  when `paceStatus === 'behind'` and there are 2+ open points) plus the
  direction text naming which points to hit.
- `ScriptService.generateScriptContent` threads `requestSummary` through to
  `SpeakerAgent.speak(script, direction, timeStatus, forceNearlyOutOfTime,
  requestSummary)`.
- `SpeakerAgent.generateSpeech`: when `requestSummary` is true, forces
  `toLlmTools([SpeakerAgentToolName.SUMMARIZE])` (same precedence as
  `forceNearlyOutOfTime` today — nearly-out-of-time still takes priority if
  both are true, since running out of time entirely trumps a content recap)
  and raises the token budget for that call to ~180 (vs. `SPEECH_MAX_TOKENS`
  = 150 for normal turns), via a new `SUMMARY_MAX_TOKENS` constant.

## Logging

- Per turn (in `chooseNextSpeaker`, after applying coverage updates):
  `logger.info` a line like
  `"6/10 points covered · 4.2/8.0 min elapsed · pace: behind"`.
- End of episode (in `ScriptService.generateScriptContent`, after the turn
  loop): log any points still `covered: false`, e.g.
  `logger.warn("2 discussion points never covered: p7 (...), p9 (...)")`.

## Testing

- `DirectorAgent` unit tests: plan creation produces points with sequential
  ids; `coveredPointIds` correctly flips point state; velocity calculation
  produces expected `paceStatus` for behind/on-pace/ahead fixtures; epsilon
  floor prevents divide-by-zero at/near `maxDuration`.
- `getVelocityNote`/`getWrapUpNote` prompt-building: snapshot-style assertions
  that open points appear in the note when behind, and that the note is
  absent when on-pace/ahead.
- `SpeakerAgent`: `requestSummary` forces the `SUMMARIZE` tool and uses the
  higher token budget; `forceNearlyOutOfTime` still wins when both flags are
  set.
- `ScriptService`: round-trip persistence — `discussionPoints` saved and
  reloaded via `loadScriptFromRecord`; defaults to `[]` for legacy records
  missing the field.
