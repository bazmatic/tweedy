import { describe, expect, it } from "vitest";
import {
  EpistemicRole,
  PodcastScript,
  SourceAccess,
  Speaker,
  UncertaintyStyle,
  VocalProviderName,
} from "../types";
import { ClosingSequencePolicy, ClosingStage } from "./ClosingSequencePolicy";

function speaker(id: string, role: EpistemicRole): Speaker {
  return {
    id,
    slug: id,
    name: id === "host" ? "Ada" : "Miles",
    personality: "thoughtful",
    voice: {
      id: `voice-${id}`,
      name: "Voice",
      description: "",
      provider: VocalProviderName.ElevenLabs,
      providerId: id,
      settings: {},
    },
    voiceStyle: "neutral",
    roleProfile: {
      epistemicRole: role,
      sourceAccess:
        role === EpistemicRole.Expert ? SourceAccess.Full : SourceAccess.HeardOnly,
      uncertaintyStyle:
        role === EpistemicRole.Expert
          ? UncertaintyStyle.Precise
          : UncertaintyStyle.ListenerSurrogate,
    },
  };
}

function script(speakers: Speaker[]): PodcastScript {
  return {
    id: "episode",
    title: "An Ending",
    description: "",
    speakers,
    speeches: [],
    materials: [],
    discussionPoints: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("ClosingSequencePolicy", () => {
  it("uses reflection, response, and sign-off as distinct turns", () => {
    const policy = new ClosingSequencePolicy();
    const host = speaker("host", EpistemicRole.AudienceGuide);
    const expert = speaker("expert", EpistemicRole.Expert);
    const episode = script([expert, host]);

    expect(policy.getStage(episode, 0)).toBe(ClosingStage.Reflection);
    expect(policy.nextTurn(episode, 0)).toMatchObject({
      speaker: { id: "host" },
      isFinalTurn: false,
    });
    expect(policy.nextTurn(episode, 0)?.direction).toContain("Do not");

    expect(policy.getStage(episode, 1)).toBe(ClosingStage.CoHostResponse);
    expect(policy.nextTurn(episode, 1)).toMatchObject({
      speaker: { id: "expert" },
      isFinalTurn: false,
    });
    expect(policy.nextTurn(episode, 1)?.direction).toContain("without");

    expect(policy.getStage(episode, 2)).toBe(ClosingStage.SignOff);
    expect(policy.nextTurn(episode, 2)).toMatchObject({
      speaker: { id: "host" },
      isFinalTurn: true,
    });
    expect(policy.nextTurn(episode, 2)?.direction).toContain("explicit farewell");
    expect(policy.nextTurn(episode, 3)).toBeNull();
  });

  it("uses a two-turn reflection and sign-off for a solo episode", () => {
    const policy = new ClosingSequencePolicy();
    const episode = script([speaker("host", EpistemicRole.AudienceGuide)]);

    expect(policy.nextTurn(episode, 0)?.isFinalTurn).toBe(false);
    expect(policy.getStage(episode, 1)).toBe(ClosingStage.SignOff);
    expect(policy.nextTurn(episode, 1)?.isFinalTurn).toBe(true);
    expect(policy.nextTurn(episode, 2)).toBeNull();
  });
});
