import { describe, expect, it } from "vitest";
import {
  EpistemicRole,
  SourceAccess,
  UncertaintyStyle,
} from "../types";
import { SpeakerRoleProfileResolver } from "./SpeakerRoleProfileResolver";

describe("SpeakerRoleProfileResolver", () => {
  const resolver = new SpeakerRoleProfileResolver();

  it("defaults to the audience-guide profile when no role has been assigned", () => {
    expect(resolver.resolve({})).toEqual({
      epistemicRole: EpistemicRole.AudienceGuide,
      sourceAccess: SourceAccess.HeardOnly,
      uncertaintyStyle: UncertaintyStyle.ListenerSurrogate,
    });
  });

  it("preserves an explicit, runtime-assigned role profile", () => {
    const explicitProfile = {
      epistemicRole: EpistemicRole.InformedHost,
      sourceAccess: SourceAccess.PreparedCards,
      uncertaintyStyle: UncertaintyStyle.Exploratory,
    };

    expect(resolver.resolve({ roleProfile: explicitProfile })).toEqual(
      explicitProfile
    );
  });

  it("preserves an explicit expert profile", () => {
    const expertProfile = {
      epistemicRole: EpistemicRole.Expert,
      sourceAccess: SourceAccess.Full,
      uncertaintyStyle: UncertaintyStyle.Precise,
    };

    expect(resolver.resolve({ roleProfile: expertProfile })).toEqual(
      expertProfile
    );
  });
});
