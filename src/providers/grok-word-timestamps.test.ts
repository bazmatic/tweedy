import { describe, expect, it } from "vitest";
import { aggregateWordTimestamps } from "./grok-word-timestamps";

function charTimes(text: string, msPerChar = 60): { chars: string[]; times: [number, number][] } {
  const chars = text.split("");
  const times: [number, number][] = chars.map((_, i) => [
    Math.round(i * msPerChar) / 1000,
    Math.round((i + 1) * msPerChar) / 1000,
  ]);
  return { chars, times };
}

describe("aggregateWordTimestamps", () => {
  it("splits plain text into words with start/end from the first/last character", () => {
    const text = "Hello world.";
    const { chars, times } = charTimes(text);

    const words = aggregateWordTimestamps(text, chars, times);

    expect(words).toEqual([
      { word: "Hello", startSeconds: times[0][0], endSeconds: times[4][1] },
      { word: "world.", startSeconds: times[6][0], endSeconds: times[11][1] },
    ]);
  });

  it("strips inline tags like [pause] and does not emit them as words", () => {
    const text = "Hello [pause] world.";
    const { chars, times } = charTimes(text);

    const words = aggregateWordTimestamps(text, chars, times);

    expect(words.map((w) => w.word)).toEqual(["Hello", "world."]);
  });

  it("strips wrapping tags like <soft>...</soft> and keeps the wrapped words", () => {
    const text = "<soft>Goodnight.</soft>";
    const { chars, times } = charTimes(text);

    const words = aggregateWordTimestamps(text, chars, times);

    expect(words).toEqual([
      {
        word: "Goodnight.",
        startSeconds: times[text.indexOf("Goodnight")][0],
        endSeconds: times[text.indexOf("Goodnight.") + "Goodnight.".length - 1][1],
      },
    ]);
  });

  it("handles multiple tags and stacked wrapping tags around real words", () => {
    const text = "There's your book deal, <slow><soft>Archie</soft></slow>.";
    const { chars, times } = charTimes(text);

    const words = aggregateWordTimestamps(text, chars, times);

    expect(words.map((w) => w.word)).toEqual([
      "There's",
      "your",
      "book",
      "deal,",
      "Archie.",
    ]);
  });

  it("returns an empty array for text that is only tags and whitespace", () => {
    const text = "[pause] [long-pause]";
    const { chars, times } = charTimes(text);

    expect(aggregateWordTimestamps(text, chars, times)).toEqual([]);
  });
});
