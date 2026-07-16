import { describe, expect, it } from "vitest";
import { toSsml, VALID_INLINE_TAGS, VALID_WRAPPING_TAGS, VALID_TAG_PATTERN } from "./google-chirp-ssml-tags";

describe("google-chirp-ssml-tags", () => {
  it("exposes the expected tag vocabulary", () => {
    expect(VALID_INLINE_TAGS).toEqual(["pause", "long-pause"]);
    expect(VALID_WRAPPING_TAGS).toEqual([
      "slow",
      "fast",
      "higher-pitch",
      "lower-pitch",
      "soft",
      "loud",
    ]);
  });

  it("VALID_TAG_PATTERN matches every inline and wrapping tag", () => {
    const sample = "Hi [pause] there [long-pause]. <slow>Slow down</slow> <fast>speed up</fast> " +
      "<higher-pitch>up</higher-pitch> <lower-pitch>down</lower-pitch> <soft>quiet</soft> <loud>LOUD</loud>";
    const matches = sample.match(VALID_TAG_PATTERN) ?? [];
    expect(matches).toEqual([
      "[pause]",
      "[long-pause]",
      "<slow>",
      "</slow>",
      "<fast>",
      "</fast>",
      "<higher-pitch>",
      "</higher-pitch>",
      "<lower-pitch>",
      "</lower-pitch>",
      "<soft>",
      "</soft>",
      "<loud>",
      "</loud>",
    ]);
  });

  it("wraps plain text in <speak> with no tags", () => {
    expect(toSsml("Hello there.")).toBe("<speak>Hello there.</speak>");
  });

  it("converts [pause] and [long-pause] to <break> elements", () => {
    expect(toSsml("Let me look, [pause] yes. [long-pause] Done.")).toBe(
      '<speak>Let me look, <break time="300ms"/> yes. <break time="900ms"/> Done.</speak>'
    );
  });

  it("converts wrapping tags to <prosody> elements", () => {
    expect(toSsml("<slow>Slow down</slow> and <fast>speed up</fast>")).toBe(
      '<speak><prosody rate="slow">Slow down</prosody> and <prosody rate="fast">speed up</prosody></speak>'
    );
    expect(toSsml("<higher-pitch>Up</higher-pitch> <lower-pitch>Down</lower-pitch>")).toBe(
      '<speak><prosody pitch="+2st">Up</prosody> <prosody pitch="-2st">Down</prosody></speak>'
    );
    expect(toSsml("<soft>Quiet</soft> <loud>LOUD</loud>")).toBe(
      '<speak><prosody volume="soft">Quiet</prosody> <prosody volume="loud">LOUD</prosody></speak>'
    );
  });

  it("XML-escapes plain text content (&, <, >) that isn't a recognized tag", () => {
    expect(toSsml("Tom & Jerry: 5 < 10 > 2")).toBe(
      "<speak>Tom &amp; Jerry: 5 &lt; 10 &gt; 2</speak>"
    );
  });

  it("escapes an unrecognized bracket/angle sequence instead of treating it as a tag", () => {
    expect(toSsml("Use <em>this</em> and [shrug]")).toBe(
      "<speak>Use &lt;em&gt;this&lt;/em&gt; and [shrug]</speak>"
    );
  });

  it("handles tags and escaped text together in one string", () => {
    expect(toSsml("A & B, [pause] then <loud>C > D</loud>.")).toBe(
      '<speak>A &amp; B, <break time="300ms"/> then <prosody volume="loud">C &gt; D</prosody>.</speak>'
    );
  });
});
