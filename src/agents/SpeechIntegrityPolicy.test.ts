import { describe, expect, it } from "vitest";
import { SpeechIntegrityPolicy } from "./SpeechIntegrityPolicy";

describe("SpeechIntegrityPolicy", () => {
  const policy = new SpeechIntegrityPolicy();

  it("accepts natural spoken dialogue", () => {
    expect(policy.isSpeakable("Wait, really? That's wild.")).toBe(true);
    expect(policy.isSpeakable("Hmm...")).toBe(true);
  });

  it("rejects empty messages", () => {
    expect(policy.isSpeakable("")).toBe(false);
    expect(policy.isSpeakable("   ")).toBe(false);
  });

  it("rejects messages containing leaked model artifacts", () => {
    expect(
      policy.isSpeakable(
        '<___ what\'s the best way to fill the space here? <tag>thinking</tag></___>\nHm, so maybe there is something intentional in what everyone else wrote off as noise? That\'s a good hook to plant.'
      )
    ).toBe(false);
    expect(policy.isSpeakable("Something <thinking> leaked here.")).toBe(
      false
    );
  });

  it("does not flag an em dash or ordinary punctuation as a tag", () => {
    expect(policy.isSpeakable("Well — that changes things.")).toBe(true);
    expect(policy.isSpeakable("Is 5 < 10? Obviously.")).toBe(true);
  });
});
