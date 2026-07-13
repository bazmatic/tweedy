import { describe, expect, it, vi } from "vitest";
import {
  AudienceValue,
  EditorialMove,
  EnergyLevel,
  Speech,
  VocalProviderName,
} from "../types";
import { TurnReviewerAgent } from "./TurnReviewerAgent";

const speaker = {
  id: "s1",
  slug: "s1",
  name: "Ada",
  personality: "warm",
  voice: {
    id: "v1",
    name: "Voice",
    description: "",
    provider: VocalProviderName.ElevenLabs,
    providerId: "voice",
    settings: {},
  },
  voiceStyle: "natural",
  isExpert: false,
};

const speech: Speech = {
  id: "sp1",
  speaker,
  message: "I kept thinking about that letter above her desk.",
  instructions: "reflective",
  voice: speaker.voice,
  voiceStyle: speaker.voiceStyle,
  timestamp: new Date(),
};

describe("TurnReviewerAgent", () => {
  it("reviews according to the assigned editorial purpose", async () => {
    const agent = new TurnReviewerAgent();
    const call = vi
      .spyOn(agent as any, "callModelForToolInput")
      .mockResolvedValue({
        accepted: true,
        clear: true,
        engaging: true,
        grounded: true,
        advancesBeat: true,
        addsVariety: true,
        roleConsistent: true,
        knowledgeConsistent: true,
        introducedCardIds: [],
      });

    await agent.review(
      speech,
      {
        speakerId: "s1",
        goal: "Humanise the subject through one telling detail.",
        move: EditorialMove.Humanise,
        cardIds: [],
        audienceValue: AudienceValue.Connection,
        desiredEnergy: EnergyLevel.Reflective,
      },
      [],
      []
    );

    const prompt = (call.mock.calls[0][0] as any)[0].content as string;
    expect(prompt).toContain("Humanise the subject");
    expect(prompt).toContain("Do not demand analysis from a story");
    expect(prompt).toContain("Australian/British spelling");
    expect(prompt).toContain("Speaker epistemic role: audience_guide");
    expect(prompt).toContain("Natural fillers, pauses, hesitations");
  });

  it("cannot accept a turn that violates role consistency", async () => {
    const agent = new TurnReviewerAgent();
    vi.spyOn(agent as any, "callModelForToolInput").mockResolvedValue({
      accepted: true,
      clear: true,
      engaging: true,
      grounded: true,
      advancesBeat: true,
      addsVariety: true,
      roleConsistent: false,
      knowledgeConsistent: true,
      introducedCardIds: [],
    });

    const result = await agent.review(
      speech,
      {
        speakerId: "s1",
        goal: "Ask for clarification.",
        move: EditorialMove.Question,
        cardIds: [],
        audienceValue: AudienceValue.Understanding,
        desiredEnergy: EnergyLevel.Curious,
      },
      [],
      []
    );

    expect(result.accepted).toBe(false);
  });
});
