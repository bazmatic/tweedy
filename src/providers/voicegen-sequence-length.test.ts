import { describe, expect, it } from 'vitest';
import {
  estimateSequenceLength,
  isTranscriptComplete,
  nextSequenceLength,
  COMPLETENESS_THRESHOLD,
  SEQUENCE_LENGTH_MIN,
  SEQUENCE_LENGTH_MAX,
} from './voicegen-sequence-length';

describe('estimateSequenceLength', () => {
  it('returns a larger estimate for a longer line than a shorter one', () => {
    const short = estimateSequenceLength('Hah. Hoping.');
    const long = estimateSequenceLength(
      'And sometimes hope is rewarded. In 1938, a South African trawler hauled up a fish, ' +
        'steel-blue with fleshy lobed fins, thought extinct for sixty-five million years.'
    );
    expect(long).toBeGreaterThan(short);
  });

  it('clamps extremely short text to the minimum', () => {
    expect(estimateSequenceLength('Yes.')).toBe(SEQUENCE_LENGTH_MIN);
  });

  it('clamps extremely long text to the maximum', () => {
    const veryLongText = new Array(2000).fill('word').join(' ');
    expect(estimateSequenceLength(veryLongText)).toBe(SEQUENCE_LENGTH_MAX);
  });
});

describe('isTranscriptComplete', () => {
  it('is true when the spoken word count matches the original', () => {
    expect(isTranscriptComplete(56, 56)).toBe(true);
  });

  it('is false when the transcript is well short of the original (truncated)', () => {
    expect(isTranscriptComplete(43, 56)).toBe(false);
  });

  it('is true right at the completeness threshold', () => {
    const originalWordCount = 100;
    const spokenWordCount = Math.ceil(originalWordCount * COMPLETENESS_THRESHOLD);
    expect(isTranscriptComplete(spokenWordCount, originalWordCount)).toBe(true);
  });

  it('is true when the transcript has slightly more words than original', () => {
    expect(isTranscriptComplete(60, 56)).toBe(true);
  });
});

describe('nextSequenceLength', () => {
  it('scales up proportionally to the observed shortfall', () => {
    // 43/56 spoken => ~77% complete, should scale up by roughly 1/0.77
    const next = nextSequenceLength(550, 43, 56);
    expect(next).toBeGreaterThan(550 * 1.2);
    expect(next).toBeLessThan(550 * 1.6);
  });

  it('never exceeds the maximum sequence length', () => {
    const next = nextSequenceLength(1900, 1, 1000);
    expect(next).toBeLessThanOrEqual(SEQUENCE_LENGTH_MAX);
  });

  it('does not divide by zero when nothing was transcribed', () => {
    const next = nextSequenceLength(550, 0, 56);
    expect(Number.isFinite(next)).toBe(true);
    expect(next).toBeLessThanOrEqual(SEQUENCE_LENGTH_MAX);
  });
});
