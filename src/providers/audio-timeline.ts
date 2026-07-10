export const OVERLAP_SECONDS = 1;
export const GAP_SECONDS = 0.3;

export interface ClipTiming {
  /** End of actual speech content, excluding any trailing silence in the clip. */
  speechEndSeconds: number;
  isInterjection: boolean;
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
      console.log("INTERJECTION");
      offsets.push(Math.max(0, previousSpeechEnd - OVERLAP_SECONDS));
    } else {
      offsets.push(previousSpeechEnd + GAP_SECONDS);
    }
  }

  return offsets;
}
