import { describe, expect, it, vi } from "vitest";
import { ScriptService } from "./ScriptService";
import { SpeakerAgentToolName } from "../agents/speaker-tools";
import { VocalProviderName, PodcastScript } from "../types";

function makeScript(): PodcastScript {
  return {
    id: "script-1",
    title: "Test Script",
    description: "A test script",
    speakers: [],
    speeches: [],
    materials: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeService(overrides: {
  speechRepository?: any;
  speakerRepository?: any;
  materialRepository?: any;
  voiceRepository?: any;
}) {
  return new ScriptService(
    {} as any,
    overrides.speakerRepository ?? ({} as any),
    overrides.materialRepository ?? ({} as any),
    overrides.voiceRepository ?? ({} as any),
    overrides.speechRepository ?? ({} as any)
  );
}

describe("ScriptService stopReason persistence", () => {
  it("persistSpeech includes stopReason when creating the SpeechRecord", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "record-1",
      speakerId: "s1",
      message: "hi",
      instructions: "calm",
      voiceId: "voice-1",
      voiceStyle: "neutral",
      timestamp: new Date(),
      stopReason: "max_tokens",
    });
    const service = makeService({ speechRepository: { create } });
    const script = makeScript();
    const speech = {
      id: "",
      speaker: {
        id: "s1",
        slug: "s1",
        name: "S1",
        personality: "",
        voice: {
          id: "voice-1",
          name: "Voice",
          description: "",
          provider: VocalProviderName.ElevenLabs,
          providerId: "p",
          settings: {},
        },
        voiceStyle: "neutral",
        isExpert: false,
      },
      message: "hi",
      instructions: "calm",
      voice: {
        id: "voice-1",
        name: "Voice",
        description: "",
        provider: VocalProviderName.ElevenLabs,
        providerId: "p",
        settings: {},
      },
      voiceStyle: "neutral",
      timestamp: new Date(),
      tool: SpeakerAgentToolName.SPEAK,
      stopReason: "max_tokens" as const,
    };

    await (service as any).persistSpeech(script, speech);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ stopReason: "max_tokens" })
    );
  });

  it("loadScriptFromRecord reads stopReason back from the SpeechRecord", async () => {
    const speakerRepository = {
      findBySlug: vi.fn().mockResolvedValue(null),
      getById: vi.fn().mockResolvedValue({
        id: "s1",
        slug: "s1",
        name: "S1",
        personality: "",
        voiceId: "voice-1",
        voiceStyle: "neutral",
        isExpert: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    };
    const voiceRepository = {
      getById: vi.fn().mockResolvedValue({
        id: "voice-1",
        name: "Voice",
        description: "",
        provider: VocalProviderName.ElevenLabs,
        providerId: "p",
        settings: {},
      }),
    };
    const materialRepository = { getById: vi.fn() };
    const speechRepository = {
      getById: vi.fn().mockResolvedValue({
        id: "record-1",
        speakerId: "s1",
        message: "hi",
        instructions: "calm",
        voiceId: "voice-1",
        voiceStyle: "neutral",
        timestamp: new Date(),
        stopReason: "max_tokens",
      }),
    };
    const service = makeService({
      speakerRepository,
      voiceRepository,
      materialRepository,
      speechRepository,
    });

    const script = await (service as any).loadScriptFromRecord({
      id: "script-1",
      title: "Test",
      description: "Test",
      speakerIds: ["s1"],
      speechIds: ["record-1"],
      materialIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect(script.speeches[0].stopReason).toBe("max_tokens");
  });
});
