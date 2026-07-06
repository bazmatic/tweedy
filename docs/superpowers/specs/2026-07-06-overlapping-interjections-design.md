# Overlapping Interjections in Final Render

## Problem

Speeches are TTS'd independently and stitched with ffmpeg's concat demuxer
(`AudioProcessor.concatenateAudio`), which places every clip back-to-back with
no overlap. Interjections (short reactions a second speaker "cuts in" with,
flagged via `speech.tool === SpeakerAgentToolName.INTERJECT`, see
`ScriptService.ts`) are inserted into the speech sequence but currently render
sequentially like any other turn — the code comment at the interjection
call site already notes this isn't "real overlap" yet.

## Goal

When an interjection follows a speech, its audio should start slightly before
the preceding speech's audio ends, so it sounds like a natural cut-in rather
than a turn-taking pause. No other transitions change.

## Design

### Timeline computation

For the ordered list of speech audio clips, compute a start offset (seconds)
per clip:

- `offset[0] = 0`
- For clip `i > 0`:
  - If clip `i` is flagged `INTERJECT`: `offset[i] = max(0, offset[i-1] + duration[i-1] - OVERLAP_SECONDS)`
  - Otherwise: `offset[i] = offset[i-1] + duration[i-1]`

This means only the interjection's start moves earlier; the clip that follows
an interjection resumes exactly when the interjection's audio ends (no
compounding overlap across multiple transitions).

`OVERLAP_SECONDS = 0.4` (default constant, adjustable later if it sounds off
in practice).

Durations are obtained via the existing `AudioProcessor.getAudioDuration`.

### Rendering

Replace the concat-demuxer approach in `AudioProcessor.concatenateAudio` with
an ffmpeg `filter_complex` graph:

1. Each input clip `i` gets `adelay=<offsetMs>|<offsetMs>[a{i}]` (offset
   converted to milliseconds, applied to both channels).
2. All delayed streams are combined with `amix=inputs=N:dropout_transition=0`
   (no fade-out when a shorter input ends).
3. The existing post-processing chain (`loudnorm`, `silenceremove`) is applied
   to the mixed output, as it is today — this also compensates for any volume
   dip `amix` introduces during overlaps.

Non-interjection runs produce identical output to today's concat behavior
(offsets are just cumulative durations), so this is a strict superset with no
behavior change for the common case.

### Data flow changes

- `Speech` (or the audio-generation pipeline) needs the `INTERJECT` flag
  available at concatenation time. `speech.tool` already carries this on the
  `Speech` object — `AudioService.generateAudio` passes the ordered
  `Speech[]` already, so we thread `speech.tool` alongside each generated
  file path into `concatenateAudio` instead of passing bare file paths.

### Testing

- Unit test the offset-computation function directly (pure function, easy to
  test with synthetic durations and a mix of flagged/unflagged clips).
- Manual listening check: render a script with at least one interjection and
  confirm the cut-in is audible and doesn't clip the preceding speaker's
  words.

## Out of scope

- No overlap for ordinary turn-taking (only flagged interjections).
- No per-interjection configurable overlap amount — single global constant.
- No change to how interjections are chosen or generated upstream.
