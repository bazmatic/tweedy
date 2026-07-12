import { WordTimestamp } from '../types';
import { VALID_TAG_PATTERN as TAG_PATTERN } from './grok-effect-tags';

function buildTagMask(text: string): boolean[] {
  const mask = new Array(text.length).fill(false);
  let match: RegExpExecArray | null;
  const pattern = new RegExp(TAG_PATTERN.source, 'g');
  while ((match = pattern.exec(text))) {
    for (let i = match.index; i < match.index + match[0].length; i++) {
      mask[i] = true;
    }
  }
  return mask;
}

/**
 * Aggregates Grok's per-character `graph_chars`/`graph_times` into word-level
 * timestamps, skipping characters that belong to effect-tag markup (e.g.
 * `[pause]`, `<soft>...</soft>`) inserted by GrokProvider.addEffectTags.
 */
export function aggregateWordTimestamps(
  text: string,
  graphChars: string[],
  graphTimes: [number, number][]
): WordTimestamp[] {
  if (graphChars.length !== graphTimes.length || graphChars.length !== text.length) {
    throw new Error(
      `Grok word-timestamp alignment mismatch: text.length=${text.length}, ` +
        `graphChars.length=${graphChars.length}, graphTimes.length=${graphTimes.length}`
    );
  }

  const mask = buildTagMask(text);
  const words: WordTimestamp[] = [];

  let currentWord = '';
  let wordStart: number | null = null;
  let wordEnd: number | null = null;

  const flush = () => {
    if (currentWord.length > 0 && wordStart !== null && wordEnd !== null) {
      words.push({ word: currentWord, startSeconds: wordStart, endSeconds: wordEnd });
    }
    currentWord = '';
    wordStart = null;
    wordEnd = null;
  };

  for (let i = 0; i < graphChars.length; i++) {
    // Masked (tag) characters are skipped without flushing the current word,
    // so a tag adjacent to real characters merges into whichever word it's
    // touching -- needed for trailing-punctuation-after-closing-tag cases
    // like "Archie</soft></slow>." -> "Archie.". This relies on
    // GrokProvider.addEffectTags's hasMidWordTag validation to guarantee a
    // tag is never inserted directly between two distinct word-characters
    // with no whitespace, so this function never actually sees two separate
    // words fused only by a tag.
    if (mask[i]) {
      continue;
    }
    const char = graphChars[i];
    if (/\s/.test(char)) {
      flush();
      continue;
    }
    if (wordStart === null) {
      wordStart = graphTimes[i][0];
    }
    wordEnd = graphTimes[i][1];
    currentWord += char;
  }
  flush();

  return words;
}
