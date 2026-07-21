import { describe, expect, it } from "vitest";
import { alignWordsToEntries } from "./timeline-word-alignment";
import type { TimelineEntry } from "../services/AudioService";
import type { WordTimestamp } from "../types";

function entry(overrides: Partial<TimelineEntry>): TimelineEntry {
  return {
    speechId: "s1",
    speakerId: "sp1",
    speakerName: "Alex",
    message: "hello there friend",
    tool: undefined,
    isInterjection: false,
    startSeconds: 0,
    endSeconds: 1,
    ...overrides,
  };
}

function word(w: string, start: number, end: number): WordTimestamp {
  return { word: w, startSeconds: start, endSeconds: end };
}

describe("alignWordsToEntries", () => {
  it("assigns each entry the matched words and updates start/end from them", () => {
    const entries: TimelineEntry[] = [
      entry({ speechId: "s1", message: "hello there friend" }),
      entry({ speechId: "s2", message: "good to see you", startSeconds: 1, endSeconds: 2 }),
    ];
    const words: WordTimestamp[] = [
      word("hello", 0.1, 0.4),
      word("there", 0.4, 0.7),
      word("friend", 0.7, 1.0),
      word("good", 1.1, 1.3),
      word("to", 1.3, 1.4),
      word("see", 1.4, 1.6),
      word("you", 1.6, 1.9),
    ];

    const result = alignWordsToEntries(entries, words);

    expect(result[0].startSeconds).toBeCloseTo(0.1);
    expect(result[0].endSeconds).toBeCloseTo(1.0);
    expect(result[0].wordTimestamps?.map((w) => w.word)).toEqual(["hello", "there", "friend"]);

    expect(result[1].startSeconds).toBeCloseTo(1.1);
    expect(result[1].endSeconds).toBeCloseTo(1.9);
    expect(result[1].wordTimestamps?.map((w) => w.word)).toEqual(["good", "to", "see", "you"]);
  });

  it("tolerates punctuation and case differences between message text and transcribed words", () => {
    const entries: TimelineEntry[] = [entry({ message: "Wait, really?!" })];
    const words: WordTimestamp[] = [
      word("wait", 0, 0.3),
      word("really", 0.3, 0.7),
    ];

    const result = alignWordsToEntries(entries, words);

    expect(result[0].wordTimestamps?.map((w) => w.word)).toEqual(["wait", "really"]);
  });

  it("tolerates a dropped/misheard word without derailing subsequent entries", () => {
    const entries: TimelineEntry[] = [
      entry({ speechId: "s1", message: "one two three four" }),
      entry({ speechId: "s2", message: "five six", startSeconds: 2, endSeconds: 3 }),
    ];
    // "three" was mis-transcribed as "free" and "two" was dropped entirely.
    const words: WordTimestamp[] = [
      word("one", 0, 0.2),
      word("free", 0.4, 0.6),
      word("four", 0.6, 0.9),
      word("five", 2.0, 2.3),
      word("six", 2.3, 2.6),
    ];

    const result = alignWordsToEntries(entries, words);

    expect(result[0].wordTimestamps?.length).toBeGreaterThan(0);
    expect(result[1].wordTimestamps?.map((w) => w.word)).toEqual(["five", "six"]);
  });

  it("does not shift a repeated word's timing earlier when one occurrence is dropped", () => {
    // Expected: "the cat the dog". Transcription dropped the first "the"
    // entirely (mis-heard as silence), so the transcript is: cat, the, dog.
    // The second "the" (at index 1) must not be stolen by the first
    // expected "the" (at index 0) -- doing so would drop "cat" from the
    // match and give the entry a wrong (too-late) start time.
    const entries: TimelineEntry[] = [entry({ speechId: "s1", message: "the cat the dog" })];
    const words: WordTimestamp[] = [
      word("cat", 0.0, 0.3),
      word("the", 0.3, 0.5),
      word("dog", 0.5, 0.8),
    ];

    const result = alignWordsToEntries(entries, words);

    expect(result[0].wordTimestamps?.map((w) => w.word)).toEqual(["cat", "the", "dog"]);
    expect(result[0].startSeconds).toBeCloseTo(0.0);
    expect(result[0].endSeconds).toBeCloseTo(0.8);
  });

  it("leaves an entry untouched if zero words can be matched to it", () => {
    const original = entry({
      speechId: "s1",
      message: "completely unrelated content",
      startSeconds: 5,
      endSeconds: 6,
      wordTimestamps: [word("cached", 5, 6)],
    });
    const entries: TimelineEntry[] = [original];
    const words: WordTimestamp[] = []; // no transcription at all

    const result = alignWordsToEntries(entries, words);

    expect(result[0]).toEqual(original);
  });
});
