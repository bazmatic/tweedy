import { describe, expect, it } from "vitest";
import {
  toCreatePodcastPlanTool,
  toSelectNextSpeakerTool,
  toVerifyCoveredPointsTool,
} from "./director-tools";
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
  it("toSelectNextSpeakerTool includes an optional coveredPointIds array field with a strict-coverage description", () => {
    const tool = toSelectNextSpeakerTool([makeSpeaker("s1")]);

    const coveredPointIds = tool.input_schema.properties
      .coveredPointIds as { type: string; items: unknown; description: string };
    expect(coveredPointIds.type).toBe("array");
    expect(coveredPointIds.items).toEqual({ type: "string" });
    expect(coveredPointIds.description).toContain(
      "explicitly and substantively discussed with specific detail"
    );
    expect(coveredPointIds.description).toContain(
      "not merely a topically-adjacent mention"
    );
    expect(tool.input_schema.required).toEqual(["speakerId", "direction"]);
  });

  it("toVerifyCoveredPointsTool requires confirmedPointIds and describes strict verification", () => {
    const tool = toVerifyCoveredPointsTool();

    expect(tool.name).toBe("verify_covered_points");
    expect(tool.input_schema.required).toEqual(["confirmedPointIds"]);
    const confirmedPointIds = tool.input_schema.properties
      .confirmedPointIds as { type: string; items: unknown; description: string };
    expect(confirmedPointIds.type).toBe("array");
    expect(confirmedPointIds.items).toEqual({ type: "string" });
    expect(confirmedPointIds.description).toContain(
      "explicitly and substantively discussed with specific detail"
    );
  });

  it("toCreatePodcastPlanTool requires narrative and points", () => {
    const tool = toCreatePodcastPlanTool();

    expect(tool.input_schema.required).toEqual(["narrative", "points"]);
    expect(tool.input_schema.properties.points).toEqual(
      expect.objectContaining({
        type: "array",
        items: { type: "string" },
      })
    );
    expect(tool.input_schema.properties).toHaveProperty("beats");
  });
});
