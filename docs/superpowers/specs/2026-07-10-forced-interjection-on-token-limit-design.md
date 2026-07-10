# Forced Interjection When a Speech Hits the Token Limit

## Problem

`BaseAgent.callModelWithTools` already recovers gracefully when a speaker's
turn gets cut off by the model's token limit — `recoverTruncatedToolCall`
salvages the partial JSON args instead of failing the turn. But nothing
downstream knows *why* the turn ended the way it did. `ScriptService`'s
interjection logic (`generateScriptContent`) only decides whether to insert a
co-host reaction based on message length (`INTERJECTION_LENGTH_THRESHOLD`)
and a random roll (`INTERJECTION_CHANCE`). A speech that got cut off
mid-thought by the token limit is exactly the case where a co-host jumping in
sounds most natural (and currently only happens 80% of the time, and only if
the truncated message happens to exceed 80 characters).

## Goal

When a speech's model call stops because it hit the token limit, the next
turn must always be an interjection — bypassing the length threshold and
chance roll entirely. Normal (non-truncated) turns keep the existing
probabilistic behavior unchanged.

## Design

### Capturing the stop reason

Add a normalized `StopReason` type to `src/types/index.ts`:

```ts
export type StopReason = "max_tokens" | "stop" | "tool_use" | "unknown";
```

Add `stopReason?: StopReason` to `Speech` and `SpeechRecord`.

In `BaseAgent.callModelWithTools` (`src/agents/BaseAgent.ts`), read the raw
provider reason off the response and normalize it:

- Anthropic (`ChatAnthropic`): `response.response_metadata.stop_reason`
  (`"max_tokens"` → `max_tokens`, `"tool_use"` → `tool_use`, `"end_turn"` /
  `"stop_sequence"` → `stop`).
- OpenAI-compatible (`ChatOpenAI`, used for DeepSeek): `finish_reason`
  (`"length"` → `max_tokens`, `"tool_calls"` → `tool_use`, `"stop"` → `stop`).
- Anything else (or missing) → `unknown`.

Include the normalized value in `callModelWithTools`'s return object
alongside `toolName`/`message`/`style`. In the existing
`recoverTruncatedToolCall` fallback branch (empty `tool_calls`, salvaged from
raw JSON), hardcode `stopReason: "max_tokens"` — that branch only executes
when generation was cut off mid-argument, so the reason is known by
construction.

### Threading through SpeakerAgent

`SpeakerAgent.generateSpeech()` and `SpeakerAgent.interject()`
(`src/agents/SpeakerAgent.ts`) both already destructure the
`callModelWithTools` result to build a `Speech`. Add `stopReason` to that
destructuring and to the constructed `Speech` object in `speak()` and
`interject()`. `createFallbackSpeech()` (the error-path fallback) leaves
`stopReason` undefined — it's not a model response, so there's nothing to
report.

### Forcing the interjection

In `ScriptService.generateScriptContent` (~`src/services/ScriptService.ts:172-208`),
replace:

```ts
const ranLong =
  speech.tool === SpeakerAgentToolName.SPEAK &&
  speech.message.length > INTERJECTION_LENGTH_THRESHOLD;

if (ranLong && script.speakers.length > 1 && Math.random() < INTERJECTION_CHANCE) {
  ...
}
```

with:

```ts
const ranLong =
  speech.tool === SpeakerAgentToolName.SPEAK &&
  speech.message.length > INTERJECTION_LENGTH_THRESHOLD;
const hitTokenLimit = speech.stopReason === "max_tokens";

const shouldInterject =
  script.speakers.length > 1 &&
  (hitTokenLimit || (ranLong && Math.random() < INTERJECTION_CHANCE));

if (shouldInterject) {
  ...
}
```

The eligible-interjector selection and `interjectionAgent.interject(script)`
call below are unchanged.

### Persistence

`ScriptService.persistSpeech` and `loadScriptFromRecord` pass `stopReason`
through when constructing/reading a `SpeechRecord`, the same way other
`Speech` fields (`message`, `instructions`, ...) are threaded today. Storage
is plain per-record JSON files with no schema, so this is a purely additive,
backward-compatible field — old records simply won't have it, and
`stopReason` will read as `undefined` for them.

Note: the pre-existing `tool` field on `Speech` has the same gap (it's never
written to or read from `SpeechRecord`), so `speech.tool` is already lost on
reload today. That's a pre-existing issue, out of scope here — `stopReason`
is being wired correctly from the start rather than perpetuating the gap.

## Testing

- Unit test the stop-reason normalization function in `BaseAgent.ts` for both
  provider shapes (Anthropic `stop_reason` values, OpenAI `finish_reason`
  values, and the truncated-recovery branch).
- Unit test `ScriptService.generateScriptContent`'s interjection decision:
  given a speech with `stopReason: "max_tokens"` and a short message (under
  the length threshold), assert an interjection is still triggered.
- Existing tests covering the probabilistic (non-truncated) interjection path
  should continue to pass unchanged.

## Out of scope

- No change to how the interjection itself is generated, or to what happens
  if an interjection's own turn also hits the token limit (no cascading
  forced interjections).
- No change to `recoverTruncatedToolCall`'s recovery logic itself.
- Not fixing the pre-existing `tool` persistence gap on `SpeechRecord`.
