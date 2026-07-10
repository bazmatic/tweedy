# Expertise-Based SPEAK Nudge — Design

## Problem

`SpeakerAgent.generateSpeech` already tells the model whether a speaker `isExpert` (`Expert` vs `General audience`), and gives experts access to the source material, but that's purely background flavor — nothing steers *tool choice*. Every speaker, expert or not, offers the same 8 tools each turn with no guidance on how often to reach for `speak` versus a short-form reaction. We want experts to carry most of the substantive `speak` turns, and non-experts to mostly react, question, and one-line, using `speak` only occasionally.

## Approach

Prompt-only nudge — no change to which tools are offered (`toLlmTools()` stays unrestricted every turn). This mirrors the existing `getBrevityNudge()` mechanism (`src/agents/SpeakerAgent.ts:202`), which already appends conditional guidance text to the prompt based on recent turn history; the new nudge is keyed on `this.speaker.isExpert` instead.

## Changes

### `src/agents/SpeakerAgent.ts`

New private method:

```ts
private getExpertiseNudge(): string
```

- If `this.speaker.isExpert`: returns guidance that this speaker has the material and should favor the `speak` tool to carry the substantive explanation — short reactions are for co-hosts, not the person who knows the subject.
- Else: returns guidance that this speaker is the audience surrogate and should favor short-form tools (`SHORT_REACTION_TOOLS`: `interject`, `filler_comment`, `short_question`, `one_liner`) — `speak` should be rare, reserved for a genuine point worth making at length.

In `generateSpeech`, append `this.getExpertiseNudge()` to the prompt right after `this.getBrevityNudge(script)`, so the two compose (e.g., a non-expert two turns into a `speak` streak gets both "you rarely speak" and "no more long turns in a row").

No other files change. `toLlmTools()`, `INTERJECTION_TOOLS`, `interject()`, and tool availability are untouched.

## Testing

Extend `src/agents/SpeakerAgent.test.ts` with a case (or two) asserting the prompt passed to `callModelWithTools` differs by `isExpert`:

- Spy on `callModelWithTools`, call `speak()` for an expert speaker and a non-expert speaker, and assert the captured prompt string contains the expert-favoring language for one and the rarely-speak language for the other.

## Out of Scope

- No change to tool availability or `toLlmTools()`.
- No change to `getBrevityNudge()`'s own logic — the two nudges just concatenate.
- No change to `interject()` / forced-interjection tool restriction.
