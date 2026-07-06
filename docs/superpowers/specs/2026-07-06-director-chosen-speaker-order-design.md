# Director-chosen speaker order

## Problem

`ScriptService.generateScriptContent` picks the next speaker with a hardcoded
round-robin index (`currentSpeakerIndex = (currentSpeakerIndex + 1) %
speakers.length`). This means, for an interviewer/expert podcast, whoever
happens to be `speakers[0]` always opens, and turns alternate mechanically
regardless of who should logically speak next (e.g. the interviewer asking a
follow-up vs. handing back to the expert).

## Change

Move the "who speaks next" decision into `DirectorAgent`, which already has
the conversation history and podcast plan in context when it generates
direction. Speaker order becomes an emergent property of the director's
judgement rather than a fixed sequence — including who opens the episode.

### `DirectorAgent`

Replace `giveDirection(speakerAgent)` with:

```ts
chooseNextSpeaker(script: PodcastScript): Promise<{ speaker: Speaker; direction: string }>
```

Implemented as a single forced tool-call (same pattern `SpeakerAgent`/
`BaseAgent.callClaudeWithTools` already use), with a tool schema:

```ts
{
  name: "select_next_speaker",
  input_schema: {
    speakerId: { enum: [...script.speakers.map(s => s.id)] },
    direction: { type: "string" }
  }
}
```

Prompt content (superset of current `giveDirection` prompt):
- Podcast plan
- Recent conversation history (last 5 speeches, as today)
- Each speaker's `name`, `personality`, and `isExpert` flag
- Existing pacing note (long-turns-need-a-punchy-reaction heuristic)
- Instruction: choose whichever speaker should naturally speak next given
  the conversation so far; on the first turn, this is expected to be the
  interviewer opening the episode, but no turn-specific logic enforces this
  — it's inferred from role and context each time.

If the returned `speakerId` doesn't match any `script.speakers` entry
(model error), fall back to a speaker other than whoever spoke last, log a
warning, and continue — no retry loop.

`IDirectorAgent.giveDirection` is removed from the interface and replaced by
`chooseNextSpeaker`.

### `ScriptService`

`generateScriptContent`'s loop drops `currentSpeakerIndex`:

```ts
for (let turn = 0; turn < params.maxTurns; turn++) {
  const { speaker, direction } = await directorAgent.chooseNextSpeaker(script);
  const speakerAgent = new SpeakerAgent(speaker);
  const speech = await speakerAgent.speak(script, direction);
  await this.persistSpeech(script, speech);

  // interjection logic unchanged, except the interjector is now
  // "a speaker other than whoever just spoke" instead of
  // script.speakers[currentSpeakerIndex]
  ...
}
```

The interjection branch (triggered when a turn runs long) picks any speaker
other than the one who just spoke, at random if there are more than two
speakers.

## Out of scope

`SpeakerAllocation` (`Random` / `Sequential` / `Managed`) is exposed as a CLI
flag (`--allocation`) but `ScriptService` already ignores it today — the
round-robin runs unconditionally. This change makes director-choice run
unconditionally in its place, and does not wire up the three allocation
modes. The enum and flag remain defined but functionally unused, same as
before. A future change could gate this behavior behind `Managed` and
implement `Random`/`Sequential` properly if that's ever needed.

## Testing

- Unit test `DirectorAgent.chooseNextSpeaker`: mock `callClaudeWithTools` to
  return a valid `speakerId`, assert the correct `Speaker` object and
  `direction` are returned.
- Unit test the fallback path: mock an invalid/unknown `speakerId`, assert a
  warning is logged and a speaker other than the last one is returned.
- Update/remove any existing tests asserting round-robin ordering in
  `ScriptService`.
