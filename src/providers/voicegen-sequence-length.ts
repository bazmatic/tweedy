// VoiceGen's Echo-TTS engine generates a fixed-length clip of `sequence_length`
// latents no matter how much speech the text actually contains. Undershooting
// truncates the clip cleanly (verified: it never corrupts into gibberish —
// that was a Whisper language-auto-detect artifact, not a real engine defect).
// So we estimate a starting length from the text, then verify+retry upward
// (see VoiceGenProvider.tts) rather than trying to nail the exact value up front.
const LATENTS_PER_SECOND = 640 / 30;

// Conservative: real measured rates for this engine's deliberate delivery style
// ranged ~1.67-1.87 words/sec, well under a typical 150wpm/2.5wps conversational
// rate. Erring slow means the first attempt is more likely to already be enough.
const WORDS_PER_SECOND = 1.7;
const PADDING_SECONDS = 1.5;

export const SEQUENCE_LENGTH_MIN = 64; // ~3s floor so very short lines aren't clipped
export const SEQUENCE_LENGTH_MAX = 2000; // schema ceiling enforced by voice-gen-service

// Bounds how many times VoiceGenProvider.tts will regenerate a clip that still
// looks truncated after verification, before accepting the last attempt as-is.
export const MAX_VERIFY_ATTEMPTS = 3;

export function estimateSequenceLength(text: string): number {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const estimatedSeconds = wordCount / WORDS_PER_SECOND + PADDING_SECONDS;
  const latents = Math.round(estimatedSeconds * LATENTS_PER_SECOND);
  return Math.min(SEQUENCE_LENGTH_MAX, Math.max(SEQUENCE_LENGTH_MIN, latents));
}

// Below this fraction of the original word count, treat the clip as truncated.
// Real data: complete clips landed at ~0.9-1.0+ spoken/original word ratio;
// truncated ones landed at ~0.12-0.77 — comfortable margin either side of 0.85.
export const COMPLETENESS_THRESHOLD = 0.85;

export function isTranscriptComplete(
  spokenWordCount: number,
  originalWordCount: number
): boolean {
  if (originalWordCount <= 0) return true;
  return spokenWordCount / originalWordCount >= COMPLETENESS_THRESHOLD;
}

// Scales sequence_length up proportionally to how short the last attempt fell,
// plus a safety margin, rather than a blind fixed increment.
const RETRY_SAFETY_MARGIN = 1.15;
const MIN_COMPLETENESS_RATIO_FOR_SCALING = 0.05; // avoid blowing up toward Infinity

export function nextSequenceLength(
  current: number,
  spokenWordCount: number,
  originalWordCount: number
): number {
  const ratio = originalWordCount <= 0 ? 1 : spokenWordCount / originalWordCount;
  const safeRatio = Math.max(ratio, MIN_COMPLETENESS_RATIO_FOR_SCALING);
  const scaled = Math.round((current / safeRatio) * RETRY_SAFETY_MARGIN);
  return Math.min(SEQUENCE_LENGTH_MAX, Math.max(SEQUENCE_LENGTH_MIN, scaled));
}
