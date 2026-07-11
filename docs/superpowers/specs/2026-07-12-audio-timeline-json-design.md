# Audio Timeline JSON

## Problem

`tweedy audio generate` produces a single mixed mp3 with no record of when each
speech starts/ends in the final mix. Downstream tooling (e.g. generating a
time-synced video) needs per-speech start/end timestamps, but that timing
information is computed and then thrown away inside `AudioProcessor`.

## Goal

Every `tweedy audio generate` run also writes a sibling JSON file describing,
for each speech in the script, when it starts and ends in the final mixed
audio track — with enough metadata (speaker, message, tool) that a downstream
consumer doesn't need to re-fetch the script to build captions or timed
cutaways.

## Design

### Where the timing data already lives

`computeClipOffsets` (`src/providers/audio-timeline.ts`) already computes the
start offset of every clip in the final ffmpeg `amix` timeline, using each
clip's real speech-end (`AudioProcessor.getSpeechEndSeconds`, which excludes
trailing TTS silence) to lay out normal clips after a `GAP_SECONDS` pause and
interjection clips overlapping the previous clip by `OVERLAP_SECONDS`.
Today, `AudioProcessor.concatenateAudio` computes this purely to build the
ffmpeg filter graph, then discards it. This design surfaces that same data
instead of recomputing it.

### Changes

**`AudioProcessor.concatenateAudio`**
Return type changes from `Promise<void>` to:

```ts
interface ConcatenationTiming {
  offsetsSeconds: number[];    // per-clip start offset in the mixed track
  speechEndSeconds: number[];  // per-clip real-speech-end (excludes trailing silence)
}
```

The function still performs concatenation as a side effect; it now also
resolves with the timing arrays it already computes internally (both arrays
are in the same input-file order as the `inputFiles`/`isInterjection`
parameters).

**`AudioService.generateAudio`**
After calling `concatenateAudio`, zip `speeches` (already in hand) with the
returned `offsetsSeconds`/`speechEndSeconds` arrays (same order, one entry per
speech) into a timeline, and write it to a sibling JSON file next to
`outputPath`:  `podcast-<scriptId>.mp3` → `podcast-<scriptId>.timeline.json`
(i.e. swap the file extension for `.timeline.json`).

`generateAudio`'s return type is unchanged (`Promise<string>`, the audio
path) — the timeline path is discoverable by filename convention, so no
caller-facing interface change is needed.

**Timeline JSON shape:**

```json
{
  "scriptId": "abc123",
  "audioFile": "podcast-abc123.mp3",
  "entries": [
    {
      "speechId": "s1",
      "speakerId": "sp1",
      "speakerName": "Ada",
      "message": "Let's talk about...",
      "tool": "SPEAK",
      "isInterjection": false,
      "startSeconds": 0.0,
      "endSeconds": 4.231
    }
  ]
}
```

- `startSeconds` = `offsetsSeconds[i]` — the clip's literal position in the
  mixed track. For an interjection, this is genuinely *before* the previous
  clip's `endSeconds`, truthfully reflecting the audio overlap rather than
  hiding it.
- `endSeconds` = `offsetsSeconds[i] + speechEndSeconds[i]`.
- Seconds as floats, rounded to 3 decimals.
- `entries` order matches `script.speeches` order (chronological turn order,
  not sorted by `startSeconds` — interjections already sit adjacent to the
  turn they interrupt in this order).
- `scriptId` is only available in `AudioCommands.ts` (not inside
  `AudioService`, which only receives `speeches`/`outputPath`), so
  `generateAudio` gains an optional `scriptId` parameter used solely to
  populate this field; if omitted, the field is omitted from the JSON.

### Out of scope

- No new CLI flag/command — this is folded into the existing `audio generate`
  flow per the approved design.
- No changes to `tweedy audio process` (single-file normalize/silence-remove
  command) — it has no multi-clip timing to report.
- Video generation itself is not part of this design — only the JSON that
  would feed it.

### Testing

- `AudioProcessor.concatenateAudio` unit tests updated to assert the resolved
  `ConcatenationTiming` shape (offsets/speechEnds arrays), not just that the
  promise resolves.
- `AudioService.generateAudio` unit test(s) added to assert the timeline JSON
  is written with the expected sibling path and entries built from a fake
  `concatenateAudio` resolution + a small `speeches` fixture, including one
  `isInterjection: true` entry.
