# Director balances speaker participation and fixes poor speeches

## Problem

Two related gaps in how `DirectorAgent` steers each turn:

1. **No participation balance signal.** `chooseNextSpeaker` already nudges pacing (`getPacingNote`) and time budget (`getVelocityNote`/`getWrapUpNote`), but nothing tracks how much each speaker has actually said. A non-expert speaker can end up dominating a conversation with no corrective signal, since the director has no visibility into cumulative word share per speaker.
2. **No quality/length backstop after generation.** Once `SpeakerAgent.speak()` returns, its message is persisted as-is. There's no check for a speech that came back too long relative to its direction, too short when the direction called for substance, or otherwise off-target — the director gives direction up front but never reviews what came back.

## Goal

- Give the director a per-turn signal about speaker balance so it can actively favor under-represented non-expert speakers, while leaving experts free to carry substantive turns.
- Let the director review each main speech against the direction it gave and, if it judges the speech too long, too short, or otherwise poor, correct the message directly — in the same LLM call that judges it, so this costs at most one extra call per turn with no retry loop.

## Design

### 1. Balance note in `chooseNextSpeaker`

Add a private `DirectorAgent.getBalanceNote(script)`, alongside the existing `getPacingNote`/`getVelocityNote`, called from `chooseNextSpeaker` and appended to the same prompt string.

- Compute each speaker's word count from `script.speeches` (same per-speech word-counting approach `estimateElapsedSeconds` already uses) and each speaker's share of the total.
- Only fires when there are ≥2 speakers and at least a handful of speeches exist (skip on very early turns where share is noisy — e.g. fewer than 3 total speeches).
- If a **non-expert** speaker's share exceeds a fixed threshold (55%), return a note: `" <Name> has dominated the conversation so far (X% of words spoken) — favor other speakers for the next turn unless the next point specifically calls for <Name>'s input."` Otherwise return `""`.
- Experts are exempt from this check entirely — they're expected to carry substantive explaining per the existing `getExpertiseNudge` design, so a high share for an expert is not a balance problem.
- No new persisted state; purely derived from `script.speeches` on each call, same pattern as the other note-generating helpers.

### 2. Speech review + direct fix

After `SpeakerAgent.speak()` returns in `ScriptService.generateScriptContent`'s main-turn path (not the `interject()` path — interjections are already short/reactive by construction and out of scope here), call a new `DirectorAgent.reviewSpeech(speech, direction)`.

- Single forced tool call: `toReviewSpeechTool()` returning `{ needsFix: boolean, revisedMessage?: string }`.
- Prompt gives the director the direction it issued for this turn and the speech's actual message, and asks it to judge whether the speech matches that direction in length and substance — flagging both a rambling/too-long speech and a too-short speech that under-delivers on a direction that called for real content — and, if `needsFix`, to write a corrected version in the same voice/register (same speaker personality/style), directly in the response.
- `ScriptService` applies the fix inline: if `needsFix` and `revisedMessage` is present, replace `speech.message` with `revisedMessage` before the speech is persisted (`persistSpeech`); otherwise persist unchanged. No retry loop — this is a single review-and-correct pass, not iterative.
- On error (model call fails), log and fall through with the original speech unchanged — same fail-open pattern as `isConversationComplete`/`verifyCoveredPoints`.

## Components

- **`src/agents/director-tools.ts`**: add `ReviewSpeechInput` type and `toReviewSpeechTool()` — schema `{ needsFix: boolean, revisedMessage?: string }`.
- **`src/agents/DirectorAgent.ts`**:
  - `private getBalanceNote(script: PodcastScript): string` — word-share computation, called from `chooseNextSpeaker` and appended to its prompt alongside the existing notes.
  - `async reviewSpeech(speech: Speech, direction: string): Promise<Speech>` — builds the review prompt, calls `callModelForToolInput<ReviewSpeechInput>`, returns a new `Speech` with `message` replaced when `needsFix` and `revisedMessage` are present, otherwise returns `speech` unchanged. Catches and logs errors, returning `speech` unchanged on failure.
- **`src/services/ScriptService.ts`**: in `generateScriptContent`, after the main `SpeakerAgent.speak()` call (not after `interject()`), call `directorAgent.reviewSpeech(speech, direction)` and use its result before `persistSpeech`.

## Testing

- `DirectorAgent.test.ts`:
  - `getBalanceNote` (via `chooseNextSpeaker`'s prompt, or exposed for direct test): empty when <2 speakers or too few speeches; empty when the dominant speaker is an expert; non-empty note naming the speaker once a non-expert crosses the 55% share threshold.
  - `reviewSpeech`: returns speech unchanged when `needsFix` is false; returns speech with `message` replaced when `needsFix` is true with a `revisedMessage`; returns speech unchanged on a mocked model-call failure.
- Manual/integration: generate a short episode and confirm the director's prompts include balance notes when one speaker runs long, and that an intentionally-too-long or too-short speech gets corrected before being persisted.

## Out of scope

- Any change to `SpeakerAgent` — it remains unaware that its output may be reviewed/edited afterward.
- Retry loops or sending feedback back to `SpeakerAgent` to regenerate — the director edits directly, in one call, for cost/latency reasons (explicit user direction).
- Reviewing or fixing interjections, fillers, one-liners, or other short-reaction tool outputs — only main `speak()`-path speeches are reviewed.
- Hard caps or deterministic overrides on speaker selection — balance is a prompt nudge to the existing LLM-driven `chooseNextSpeaker` call, not a rule that overrides its choice.
