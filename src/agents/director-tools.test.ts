import { describe, expect, it } from "vitest";
import { toCreatePodcastPlanTool, toSelectNextSpeakerTool } from "./director-tools";
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

describe("director-tools", () => {
  it("toSelectNextSpeakerTool includes an optional coveredPointIds array field", () => {
    const tool = toSelectNextSpeakerTool([makeSpeaker("s1")]);

    expect(tool.input_schema.properties.coveredPointIds).toEqual({
      type: "array",
      items: { type: "string" },
      description:
        "IDs of currently-open discussion points that the most recent speech(es) addressed. Omit or leave empty if none were covered.",
    });
    expect(tool.input_schema.required).toEqual(["speakerId", "direction"]);
  });

  it("toCreatePodcastPlanTool requires narrative and points", () => {
    const tool = toCreatePodcastPlanTool();

    expect(tool.input_schema.required).toEqual(["narrative", "points"]);
    expect(tool.input_schema.properties.points).toEqual({
      type: "array",
      items: { type: "string" },
      description:
        "3-8 concrete, discrete discussion points that must be covered during the episode, each a short phrase.",
    });
  });
});
