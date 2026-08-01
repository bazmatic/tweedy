export const OVERLAP_SECONDS = 0;
export const GAP_SECONDS = 0.3;
// A cold open is a dramatic hook — it needs a beat of silence before the
// show properly starts, longer than the standard inter-clip gap.
export const COLD_OPEN_GAP_SECONDS = 1.2;

export interface ClipTiming {
  /** End of actual speech content, excluding any trailing silence in the clip. */
  speechEndSeconds: number;
  isInterjection: boolean;
  /** Whether this clip is the episode's cold open. */
  isColdOpen?: boolean;
}

export function computeClipOffsets(clips: ClipTiming[]): number[] {
  const offsets: number[] = [];

  for (let i = 0; i < clips.length; i++) {
    if (i === 0) {
      offsets.push(0);
      continue;
    }

    const previous = clips[i - 1];
    const previousSpeechEnd = offsets[i - 1] + previous.speechEndSeconds;

    if (clips[i].isInterjection) {
      offsets.push(Math.max(0, previousSpeechEnd - OVERLAP_SECONDS));
    } else if (previous.isColdOpen) {
      offsets.push(previousSpeechEnd + COLD_OPEN_GAP_SECONDS);
    } else {
      offsets.push(previousSpeechEnd + GAP_SECONDS);
    }
  }

  return offsets;
}
