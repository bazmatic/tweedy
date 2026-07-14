import { describe, expect, it } from "vitest";
import {
  EpistemicRole,
  SourceAccess,
  UncertaintyStyle,
} from "../types";
import { SpeakerRoleProfileResolver } from "./SpeakerRoleProfileResolver";

describe("SpeakerRoleProfileResolver", () => {
  const resolver = new SpeakerRoleProfileResolver();

  it("maps a legacy expert to the default expert profile", () => {
    expect(resolver.resolve({ isExpert: true })).toEqual({
      epistemicRole: EpistemicRole.Expert,
      sourceAccess: SourceAccess.Full,
      uncertaintyStyle: UncertaintyStyle.Precise,
    });
  });

  it("maps a legacy non-expert to the audience-guide profile", () => {
    expect(resolver.resolve({ isExpert: false })).toEqual({
      epistemicRole: EpistemicRole.AudienceGuide,
      sourceAccess: SourceAccess.HeardOnly,
      uncertaintyStyle: UncertaintyStyle.ListenerSurrogate,
    });
  });

  it("preserves an explicit role profile", () => {
    const explicitProfile = {
      epistemicRole: EpistemicRole.InformedHost,
      sourceAccess: SourceAccess.PreparedCards,
      uncertaintyStyle: UncertaintyStyle.Exploratory,
    };

    expect(
      resolver.resolve({ isExpert: false, roleProfile: explicitProfile })
    ).toEqual(explicitProfile);
  });
});
