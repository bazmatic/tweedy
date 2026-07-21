import type { TimelineEntry } from "../services/AudioService";
import type { WordTimestamp } from "../types";

function normalize(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9']/g, "");
}

function expectedWords(message: string): string[] {
  return message
    .split(/\s+/)
    .map(normalize)
    .filter((w) => w.length > 0);
}

/** How many transcribed words we're willing to look past when the next
 * expected word doesn't match the next transcribed word, before giving up
 * on aligning the rest of the current entry. Absorbs typical Whisper noise
 * (dropped words, misheard words, filler insertions). */
const LOOKAHEAD_TOLERANCE = 3;

/**
 * Walks the transcribed word stream once, consuming words into each entry
 * in order. An entry whose expected words can't be found within tolerance
 * is left with its original timing/wordTimestamps untouched.
 */
export function alignWordsToEntries(
  entries: TimelineEntry[],
  transcribedWords: WordTimestamp[]
): TimelineEntry[] {
  let cursor = 0;

  return entries.map((entry) => {
    const expected = expectedWords(entry.message);
    if (expected.length === 0) return entry;

    const matched: WordTimestamp[] = [];
    let expectedIndex = 0;
    let searchStart = cursor;

    while (expectedIndex < expected.length && searchStart < transcribedWords.length) {
      const target = expected[expectedIndex];
      let found = -1;

      for (
        let i = searchStart;
        i < Math.min(searchStart + LOOKAHEAD_TOLERANCE + 1, transcribedWords.length);
        i++
      ) {
        if (normalize(transcribedWords[i].word) === target) {
          found = i;
          break;
        }
      }

      if (found === -1) {
        // Couldn't find this expected word nearby; skip it (treat as a
        // dropped/misheard word) and keep going with the rest of the entry.
        expectedIndex++;
        continue;
      }

      matched.push(transcribedWords[found]);
      searchStart = found + 1;
      expectedIndex++;
    }

    if (matched.length === 0) {
      return entry;
    }

    cursor = searchStart;

    return {
      ...entry,
      startSeconds: matched[0].startSeconds,
      endSeconds: matched[matched.length - 1].endSeconds,
      wordTimestamps: matched,
    };
  });
}
