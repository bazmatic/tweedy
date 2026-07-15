import { describe, expect, it } from "vitest";
import { EditorialMove, Speech, VocalProviderName } from "../types";
import { ConversationRhythmPolicy } from "./ConversationRhythmPolicy";
import { SpeakerAgentToolName } from "./speaker-tools";

const speaker = {
  id: "s1",
  slug: "s1",
  name: "Ada",
  personality: "curious",
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

function speech(tool: SpeakerAgentToolName): Speech {
  return {
    id: Math.random().toString(),
    speaker,
    message: "A turn",
    instructions: "",
    voice: speaker.voice,
    voiceStyle: speaker.voiceStyle,
    timestamp: new Date(),
    tool,
  };
}

describe("ConversationRhythmPolicy", () => {
  it("asks for substance after a run of reactions", () => {
    const recommendation = new ConversationRhythmPolicy().recommend([
      speech(SpeakerAgentToolName.INTERJECT),
      speech(SpeakerAgentToolName.FILLER_COMMENT),
    ]);

    expect(recommendation?.preferredMoves).toContain(EditorialMove.TellStory);
    expect(recommendation?.avoidedMoves).toContain(EditorialMove.React);
  });

  it("asks for variation after consecutive substantive turns", () => {
    const recommendation = new ConversationRhythmPolicy().recommend([
      speech(SpeakerAgentToolName.SPEAK),
      speech(SpeakerAgentToolName.SPEAK),
    ]);

    expect(recommendation?.preferredMoves).toContain(EditorialMove.Question);
    expect(recommendation?.avoidedMoves).toContain(EditorialMove.Explain);
    expect(recommendation?.avoidedMoves).toContain(EditorialMove.Reframe);
  });
});
