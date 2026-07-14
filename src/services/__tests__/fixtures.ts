import { SpeakerAgentToolName } from "../../agents/speaker-tools";
import { PodcastScript, VocalProviderName } from "../../types";

interface ScriptFixtureOptions {
  messages?: string[];
  includeSecondSpeaker?: boolean;
}

export function makeScriptFixture(
  options: ScriptFixtureOptions = {}
): PodcastScript {
  const speaker = {
    id: "speaker-1",
    slug: "ada",
    name: "Ada",
    personality: "warm",
    voice: {
      id: "voice-1",
      name: "Voice",
      description: "",
      provider: VocalProviderName.ElevenLabs,
      providerId: "provider-1",
      settings: {},
    },
    voiceStyle: "natural",
    isExpert: false,
  };
  const messages = options.messages ?? ["First line.\nStill the first turn."];
  const speeches = messages.map((message, index) => ({
    id: `speech-${index + 1}`,
    speaker,
    message,
    instructions: "natural",
    voice: speaker.voice,
    voiceStyle: speaker.voiceStyle,
    timestamp: new Date("2026-07-14T00:00:00.000Z"),
    tool: SpeakerAgentToolName.SPEAK,
  }));
  const speakers = options.includeSecondSpeaker
    ? [
        speaker,
        {
          ...speaker,
          id: "speaker-2",
          slug: "miles",
          name: "Miles",
        },
      ]
    : [speaker];

  return {
    id: "script-1",
    title: "Test",
    description: "",
    speakers,
    speeches,
    materials: [],
    discussionPoints: [],
    createdAt: new Date("2026-07-14T00:00:00.000Z"),
    updatedAt: new Date("2026-07-14T01:00:00.000Z"),
  };
}
