import { describe, expect, it } from "vitest";
import { SpeechRevisionPolicy } from "./SpeechRevisionPolicy";

describe("SpeechRevisionPolicy", () => {
  const policy = new SpeechRevisionPolicy();

  it("accepts complete spoken revisions", () => {
    expect(policy.isUsable("Um, that is the central result.")).toBe(true);
    expect(policy.isUsable("But what does it mean?")).toBe(true);
    expect(policy.isUsable("I mean...")).toBe(true);
  });

  it("rejects empty and visibly truncated revisions", () => {
    expect(policy.isUsable("")).toBe(false);
    expect(policy.isUsable("A sprawling network weaving through the soil,"))
      .toBe(false);
  });
});
