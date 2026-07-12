import { WordTimestamp } from '../types';

const VALID_INLINE_TAGS = [
  'pause',
  'long-pause',
  'hum-tune',
  'laugh',
  'chuckle',
  'giggle',
  'cry',
  'tsk',
  'tongue-click',
  'lip-smack',
  'breath',
  'inhale',
  'exhale',
  'sigh',
];
const VALID_WRAPPING_TAGS = [
  'soft',
  'whisper',
  'loud',
  'build-intensity',
  'decrease-intensity',
  'higher-pitch',
  'lower-pitch',
  'slow',
  'fast',
  'sing-song',
  'singing',
  'laugh-speak',
  'emphasis',
];
const TAG_PATTERN = new RegExp(
  `\\[(?:${VALID_INLINE_TAGS.join('|')})\\]|</?(?:${VALID_WRAPPING_TAGS.join('|')})>`,
  'g'
);

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
