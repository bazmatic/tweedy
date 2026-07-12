import { describe, expect, it, vi, beforeEach } from "vitest";
import { ScriptService } from "./ScriptService";
import { SpeakerAgentToolName } from "../agents/speaker-tools";
import { VocalProviderName, PodcastScript, SourceType } from "../types";
import type { RAGService } from "../rag";

const chooseNextSpeakerMock = vi.fn();
const createPodcastPlanMock = vi.fn().mockResolvedValue(undefined);
const speakMock = vi.fn();
const speakerAgentConstructorMock = vi.fn();

vi.mock("../agents", () => ({
  DirectorAgent: vi.fn().mockImplementation(function () {
    return {
      createPodcastPlan: createPodcastPlanMock,
      chooseNextSpeaker: chooseNextSpeakerMock,
    };
  }),
  SpeakerAgent: vi.fn().mockImplementation(function (speaker, ragService) {
    speakerAgentConstructorMock(speaker, ragService);
    return { speak: speakMock, interject: vi.fn() };
  }),
}));

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
  ragService?: any;
}) {
  return new ScriptService(
    {} as any,
    overrides.speakerRepository ?? ({} as any),
    overrides.materialRepository ?? ({} as any),
    overrides.voiceRepository ?? ({} as any),
    overrides.speechRepository ?? ({} as any),
    overrides.ragService ?? ({ addMaterials: vi.fn() } as any)
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

describe("ScriptService RAG wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds script materials to RAG once and injects ragService into each SpeakerAgent", async () => {
    const addMaterials = vi.fn().mockResolvedValue(undefined);
    const ragService = { addMaterials } as unknown as RAGService;

    const speaker = {
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
      isExpert: true,
    };
    chooseNextSpeakerMock.mockResolvedValue({
      speaker,
      direction: "talk about x",
      timeStatus: "",
      forceNearlyOutOfTime: false,
    });
    speakMock.mockResolvedValue({
      id: "",
      speaker,
      message: "hi",
      instructions: "calm",
      voice: speaker.voice,
      voiceStyle: "neutral",
      timestamp: new Date(),
      tool: SpeakerAgentToolName.SPEAK,
      stopReason: "stop",
    });

    const speechRepository = {
      create: vi.fn().mockResolvedValue({ id: "record-1" }),
    };
    const service = makeService({ speechRepository, ragService });

    const script = makeScript();
    script.materials = [
      {
        id: "m1",
        title: "T",
        content: "C",
        source: "s",
        sourceType: SourceType.Manual,
        metadata: {},
        createdAt: new Date(),
      },
    ];

    await (service as any).generateScriptContent(script, {
      maxTurns: 1,
      maxDuration: 60,
    });

    expect(addMaterials).toHaveBeenCalledWith(script.materials);
    expect(speakerAgentConstructorMock).toHaveBeenCalledWith(
      speaker,
      ragService
    );
  });

  it("continues script generation when ragService.addMaterials rejects", async () => {
    const addMaterials = vi.fn().mockRejectedValue(new Error("embedding model load failed"));
    const ragService = { addMaterials } as unknown as RAGService;

    const speaker = {
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
      isExpert: true,
    };
    chooseNextSpeakerMock.mockResolvedValue({
      speaker,
      direction: "talk about x",
      timeStatus: "",
      forceNearlyOutOfTime: false,
    });
    speakMock.mockResolvedValue({
      id: "",
      speaker,
      message: "hi",
      instructions: "calm",
      voice: speaker.voice,
      voiceStyle: "neutral",
      timestamp: new Date(),
      tool: SpeakerAgentToolName.SPEAK,
      stopReason: "stop",
    });

    const speechRepository = {
      create: vi.fn().mockResolvedValue({ id: "record-1" }),
    };
    const service = makeService({ speechRepository, ragService });

    const script = makeScript();
    script.materials = [
      {
        id: "m1",
        title: "T",
        content: "C",
        source: "s",
        sourceType: SourceType.Manual,
        metadata: {},
        createdAt: new Date(),
      },
    ];

    await expect(
      (service as any).generateScriptContent(script, {
        maxTurns: 1,
        maxDuration: 60,
      })
    ).resolves.toBeUndefined();

    expect(addMaterials).toHaveBeenCalledWith(script.materials);
    expect(speechRepository.create).toHaveBeenCalled();
  });
});
