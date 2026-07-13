import { describe, expect, it } from "vitest";
import {
  EpistemicRole,
  SourceAccess,
  UncertaintyStyle,
} from "../types";
import { NaturalSpeechStylePolicy } from "./NaturalSpeechStylePolicy";

describe("NaturalSpeechStylePolicy", () => {
  const policy = new NaturalSpeechStylePolicy();

  it.each(Object.values(EpistemicRole))(
    "retains fillers and hesitations for %s speakers",
    (epistemicRole) => {
      const guidance = policy.buildGuidance({
        epistemicRole,
        sourceAccess: SourceAccess.Full,
        uncertaintyStyle: UncertaintyStyle.Precise,
      });

      expect(guidance).toContain("um, uh, like and you know");
      expect(guidance).toContain("false starts and self-corrections");
    }
  );

  it("distinguishes expert hesitation from lack of knowledge", () => {
    const guidance = policy.buildGuidance({
      epistemicRole: EpistemicRole.Expert,
      sourceAccess: SourceAccess.Full,
      uncertaintyStyle: UncertaintyStyle.Precise,
    });

    expect(guidance).toContain("finding clear phrasing");
    expect(guidance).toContain("not because foundational material surprises");
  });
});
