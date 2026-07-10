export const OVERLAP_SECONDS = 0.8;

export interface ClipTiming {
  durationSeconds: number;
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
    const previousEnd = offsets[i - 1] + previous.durationSeconds;

    offsets.push(
      clips[i].isInterjection
        ? Math.max(0, previousEnd - OVERLAP_SECONDS)
        : previousEnd
    );
  }

  return offsets;
}
