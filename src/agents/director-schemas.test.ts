import { describe, expect, it } from "vitest";
import {
  checkConversationCompleteSchema,
  createPodcastPlanSchema,
  createSelectNextSpeakerSchema,
  verifyCoveredPointsSchema,
} from "./director-schemas";
import { Speaker, VocalProviderName } from "../types";

function makeSpeaker(id: string): Speaker {
  return {
    id,
    slug: id,
    name: `Speaker ${id}`,
    personality: "curious",
    voice: {
      id: `voice-${id}`,
      name: "Voice",
      description: "",
      provider: VocalProviderName.ElevenLabs,
      providerId: "provider-id",
      settings: {},
    },
    voiceStyle: "neutral",
    isExpert: false,
  };
}

describe("director structured-output schemas", () => {
  it("accepts speaker references for programmatic resolution", () => {
    const schema = createSelectNextSpeakerSchema([makeSpeaker("s1")]);

    expect(
      schema.parse({ speakerId: "s1", direction: "Open the episode" })
    ).toEqual({ speakerId: "s1", direction: "Open the episode" });
    expect(
      schema.parse({ speakerId: "Speaker s1", direction: "Open the episode" })
    ).toEqual({ speakerId: "Speaker s1", direction: "Open the episode" });
  });

  it("requires both the plan narrative and discussion points", () => {
    expect(
      createPodcastPlanSchema.parse({
        narrative: "Open warmly, explore the subject, then conclude.",
        points: ["How the signalling works"],
      })
    ).toEqual({
      narrative: "Open warmly, explore the subject, then conclude.",
      points: ["How the signalling works"],
    });
    expect(() =>
      createPodcastPlanSchema.parse({ narrative: "Incomplete plan" })
    ).toThrow();
  });

  it("validates coverage verification and conclusion decisions", () => {
    expect(
      verifyCoveredPointsSchema.parse({ confirmedPointIds: ["p1"] })
    ).toEqual({ confirmedPointIds: ["p1"] });
    expect(checkConversationCompleteSchema.parse({ isComplete: true })).toEqual(
      { isComplete: true }
    );
  });
});
