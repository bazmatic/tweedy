# Grok Word-Level Timestamps Design

## Goal

When generating audio with a voice provider that supports it (currently only Grok), capture word-level timestamps for each speech and include them in the existing per-run `.timeline.json` output, alongside the clip-level `startSeconds`/`endSeconds` already written today.

## Background

- `AudioService.generateAudio` already writes a `.timeline.json` sibling file next to the mixed audio output, with one `TimelineEntry` per speech containing clip-level `startSeconds`/`endSeconds` in the final mixed track (see `docs/superpowers/plans/2026-07-12-audio-timeline-json.md`).
- `IVocalProvider.tts()` currently returns `Promise<string>` (just the output file path). All timing/metadata from the provider's TTS call is discarded once the audio bytes are written to disk.
- xAI's Grok TTS API supports a `with_timestamps: true` request flag. When set, the response becomes a JSON envelope (`audio` base64 string, `content_type`, `duration`, `audio_timestamps: { graph_chars, graph_times }`) instead of raw audio bytes. `graph_chars`/`graph_times` are parallel arrays giving a `[start, end]` second pair for every character of the input text, mirroring the input one-for-one including spaces, punctuation, and speech tags.
- `GrokProvider.addEffectTags` inserts inline (`[pause]`, `[laugh]`, ...) and wrapping (`<soft>...</soft>`, ...) markup into the text actually sent to the TTS API. Those tag characters appear in `graph_chars` interleaved with real words and must not leak into word-level output.
- No other provider (OpenAI, ElevenLabs, Hume, Cartesia, Kokoro) currently exposes any timing data from its API.

## Non-Goals

- Character-level timestamps are not exposed in the timeline JSON — only word-level, aggregated from Grok's character data.
- No new CLI flag or command; this folds into the existing `audio generate` flow, matching the existing timeline JSON feature.
- No timestamp support for any provider other than Grok in this iteration. Other providers simply omit the new field.
- No retrofitting of tag *timing* as its own visible artifact — tag character spans are used only to identify what to strip, not surfaced as pseudo-words.

## Design

### 1. `IVocalProvider.tts()` return type

Change from `Promise<string>` to `Promise<TtsResult>`, a new type in `src/types/index.ts`:

```ts
export interface WordTimestamp {
  word: string;
  startSeconds: number;
  endSeconds: number;
}

export interface TtsResult {
  outputPath: string;
  wordTimestamps?: WordTimestamp[]; // clip-relative seconds; present only when the provider supports it
}
```

`IVocalProvider.tts(params: VocalProviderTtsParams): Promise<TtsResult>`.

Every existing provider (`OpenAIProvider`, `ElevenLabsProvider`, `HumeProvider`, `CartesiaProvider`, `KokoroProvider`) changes its final `return outputPath;` to `return { outputPath };`. No other logic in those providers changes.

### 2. `GrokProvider.tts()` — request and response handling

- Add `with_timestamps: true` to the POST body sent to `${baseUrl}/tts`.
- Because the response is now the JSON envelope rather than raw bytes, change the axios call's `responseType` from `'arraybuffer'` to the default (JSON), and base64-decode `response.data.audio` into a `Buffer` before `fs.writeFile`.
- After writing the audio file, compute `wordTimestamps` from `response.data.audio_timestamps` (see §3) and include it in the returned `TtsResult`.
- If `audio_timestamps` is missing/malformed for any reason, log a warning and return `{ outputPath }` without `wordTimestamps` rather than throwing — timestamp capture is additive and must never break audio generation.

### 3. Word aggregation, tag-aware

Given `graph_chars: string[]` and `graph_times: [number, number][]` (same length, index-aligned):

1. Build a boolean mask the same length as `graph_chars`, marking every character index that falls inside a tag span. Reuse the existing `VALID_TAG_PATTERN` regex (already defined in `GrokProvider.ts` for inline `[tag]` and wrapping `<tag>...</tag>` forms) against the *reconstructed string* (`graph_chars.join('')`, which is exactly the text sent to the API), then mark all matched index ranges.
2. Walk the unmasked characters left to right, splitting on whitespace (unmasked space characters) into runs of contiguous non-space, non-masked characters. Each run is one word.
3. For each word run: `word` = the concatenated characters; `startSeconds` = `graph_times[firstIndexInRun][0]`; `endSeconds` = `graph_times[lastIndexInRun][1]`.
4. Masked (tag) characters and whitespace produce no word entries — they're skipped, not emitted as empty/pseudo-words.

This yields `wordTimestamps` describing only the real spoken words, with clean text and accurate per-word timing, regardless of how many effect tags were interleaved by `addEffectTags`.

### 4. Timeline JSON integration

- `AudioService.generateSpeechAudio` (`src/services/AudioService.ts`) changes its return type from `Promise<string>` to `Promise<TtsResult & { speech: Speech }>` internally (or equivalent), so `generateAudio` can collect per-speech `wordTimestamps` alongside the audio file paths it already collects for concatenation.
- `TimelineEntry` gains an optional field:
  ```ts
  interface TimelineEntry {
    // ...existing fields unchanged...
    wordTimestamps?: { word: string; startSeconds: number; endSeconds: number }[];
  }
  ```
- In `writeTimeline`, when a speech has `wordTimestamps`, shift each word's `startSeconds`/`endSeconds` by that entry's own clip `startSeconds` (the offset already computed for the clip in the mixed track — same offset used for the entry's top-level `startSeconds`/`endSeconds`), so word timestamps are track-relative and directly usable against the final mixed audio file without further math. When a speech has no `wordTimestamps` (non-Grok provider, or Grok returned none), the field is omitted from that entry entirely — not written as an empty array.

## Testing

- `GrokProvider.test.ts`:
  - Request body includes `with_timestamps: true`.
  - JSON envelope response (`audio`, `audio_timestamps`) is correctly base64-decoded and written to disk, and `TtsResult.wordTimestamps` matches expected word boundaries for a plain-text input.
  - A case with an inline tag (e.g. `"Hello [pause] world."`) and a wrapping tag pair (e.g. `"<soft>Goodnight.</soft>"`) produces `wordTimestamps` containing only the real words (`"Hello"`, `"world."` / `"Goodnight."`), with correct start/end seconds and no tag-derived entries.
  - Missing/malformed `audio_timestamps` in the response falls back to `{ outputPath }` with a logged warning, and does not throw.
- Other providers' existing tests are updated for the `{ outputPath }` return shape (mechanical change, no new behavior to test).
- `AudioService.test.ts` (or equivalent): `writeTimeline` includes shifted `wordTimestamps` on entries where the underlying `TtsResult` provided them, and omits the field otherwise.

## Open Questions / Assumptions

- Assumes `graph_chars.join('')` reconstructs exactly the text sent to Grok (per xAI docs: "mirrors your input one-for-one, including spaces, punctuation, and speech tags"). If a future Grok API revision normalizes text before echoing characters back, the tag-masking regex match against the reconstructed string would need revisiting.
