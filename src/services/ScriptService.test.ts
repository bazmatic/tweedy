import { describe, expect, it, vi, beforeEach } from "vitest";
import { ScriptService } from "./ScriptService";
import { SpeakerAgentToolName } from "../agents/speaker-tools";
import {
  AudienceProfile,
  AudienceValue,
  BeatPurpose,
  EditorialCardKind,
  EditorialMove,
  EnergyLevel,
  KnowledgeSource,
  VocalProviderName,
  PodcastScript,
  SourceType,
} from "../types";
import type { RAGService } from "../rag";
import { logger } from "../utils/logger";

const chooseNextSpeakerMock = vi.fn();
const createPodcastPlanMock = vi.fn().mockResolvedValue(undefined);
const reviewSpeechMock = vi.fn((speech) => Promise.resolve(speech));
const speakMock = vi.fn();
const interjectMock = vi.fn();
const speakerAgentConstructorMock = vi.fn();

const directorAgentConstructorMock = vi.fn();

vi.mock("../agents", () => ({
  DirectorAgent: vi.fn().mockImplementation(function (...args: unknown[]) {
    directorAgentConstructorMock(...args);
    return {
      createPodcastPlan: createPodcastPlanMock,
      chooseNextSpeaker: chooseNextSpeakerMock,
      reviewSpeech: reviewSpeechMock,
    };
  }),
  SpeakerAgent: vi.fn().mockImplementation(function (speaker, ragService) {
    speakerAgentConstructorMock(speaker, ragService);
    return { speak: speakMock, interject: interjectMock };
  }),
  SpeechRepetitionPolicy: vi.fn().mockImplementation(function () {
    return { isRepetition: vi.fn().mockReturnValue(false) };
  }),
  EpisodeRecapPolicy: vi.fn().mockImplementation(function () {
    return { buildRecap: vi.fn().mockReturnValue("") };
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
    discussionPoints: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeService(overrides: {
  scriptRepository?: any;
  speechRepository?: any;
  speakerRepository?: any;
  materialRepository?: any;
  voiceRepository?: any;
  ragService?: any;
}) {
  return new ScriptService(
    overrides.scriptRepository ?? ({} as any),
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
      turnBrief: {
        speakerId: "s1",
        goal: "Explain the turning point.",
        move: EditorialMove.Explain,
        cardIds: [],
        audienceValue: AudienceValue.Understanding,
        desiredEnergy: EnergyLevel.Curious,
      },
    };

    await (service as any).persistSpeech(script, speech);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        stopReason: "max_tokens",
        turnBrief: expect.objectContaining({
          goal: "Explain the turning point.",
        }),
      })
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

describe("ScriptService opening sequence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enforces welcome then acknowledgement without inserting a random interjection", async () => {
    const host = {
      id: "host",
      slug: "ada",
      name: "Ada",
      personality: "warm",
      voice: {
        id: "voice-host",
        name: "Voice",
        description: "",
        provider: VocalProviderName.ElevenLabs,
        providerId: "p",
        settings: {},
      },
      voiceStyle: "neutral",
      isExpert: false,
    };
    const expert = {
      ...host,
      id: "expert",
      slug: "miles",
      name: "Miles",
      voice: { ...host.voice, id: "voice-expert" },
      isExpert: true,
    };
    const script = makeScript();
    script.speakers = [expert, host];

    speakMock
      .mockResolvedValueOnce({
        id: "",
        speaker: host,
        message: "Picture this...",
        instructions: "warm",
        voice: host.voice,
        voiceStyle: host.voiceStyle,
        timestamp: new Date(),
        tool: SpeakerAgentToolName.SPEAK,
        stopReason: "stop",
      })
      .mockResolvedValueOnce({
        id: "",
        speaker: host,
        message: "A deliberately long welcome that would normally qualify for a random interjection under the length policy.",
        instructions: "warm",
        voice: host.voice,
        voiceStyle: host.voiceStyle,
        timestamp: new Date(),
        tool: SpeakerAgentToolName.SPEAK,
        stopReason: "stop",
      })
      .mockResolvedValueOnce({
        id: "",
        speaker: expert,
        message: "Hello Ada, and hello everyone.",
        instructions: "warm",
        voice: expert.voice,
        voiceStyle: expert.voiceStyle,
        timestamp: new Date(),
        tool: SpeakerAgentToolName.SPEAK,
        stopReason: "stop",
      });

    let recordNumber = 0;
    const speechRepository = {
      create: vi.fn().mockImplementation(async () => ({
        id: `record-${++recordNumber}`,
      })),
    };
    const service = makeService({ speechRepository });

    await (service as any).generateScriptContent(script, {
      maxTurns: 3,
      maxDuration: 60,
    });

    expect(script.speeches.map((speech) => speech.speaker.name)).toEqual([
      "Ada",
      "Ada",
      "Miles",
    ]);
    expect(speakMock.mock.calls[0][5]).toContain("Open cold");
    expect(speakMock.mock.calls[1][5]).toContain("introduce Miles");
    expect(speakMock.mock.calls[2][5]).toContain(
      "Respond directly to Ada's introduction"
    );
    expect(interjectMock).not.toHaveBeenCalled();
    expect(chooseNextSpeakerMock).not.toHaveBeenCalled();
  });

  it("forces the cold open tool on the very first opening turn", async () => {
    let recordNumber = 0;
    const speechRepository = {
      create: vi.fn().mockImplementation(async () => ({
        id: `record-${++recordNumber}`,
      })),
    };
    const service = makeService({ speechRepository });
    const script = makeScript();
    script.speakers = [
      {
        id: "host",
        slug: "host",
        name: "Ada",
        personality: "warm",
        voice: {
          id: "voice-host",
          name: "Voice",
          description: "",
          provider: VocalProviderName.ElevenLabs,
          providerId: "provider-id",
          settings: {},
        },
        voiceStyle: "natural",
        isExpert: false,
      },
      {
        id: "expert",
        slug: "expert",
        name: "Miles",
        personality: "curious",
        voice: {
          id: "voice-expert",
          name: "Voice",
          description: "",
          provider: VocalProviderName.ElevenLabs,
          providerId: "provider-id",
          settings: {},
        },
        voiceStyle: "natural",
        isExpert: true,
      },
    ];

    speakMock.mockResolvedValue({
      id: "speech-hook",
      speaker: script.speakers[0],
      message: "Picture a mushroom, wired for sound.",
      instructions: "slow, deliberate",
      voice: script.speakers[0].voice,
      voiceStyle: script.speakers[0].voiceStyle,
      timestamp: new Date(),
      tool: SpeakerAgentToolName.COLD_OPEN,
    });

    await (service as any).generateScriptContent(script, {
      maxTurns: 1,
      maxDuration: 60,
    });

    expect(speakMock.mock.calls[0][8]).toBe(true); // forceColdOpen
    expect(script.speeches[0].tool).toBe(SpeakerAgentToolName.COLD_OPEN);
  });
});

describe("ScriptService.logUncoveredPoints", () => {
  it("warns listing every point still not covered", () => {
    const service = makeService({});
    const script = makeScript();
    script.discussionPoints = [
      { id: "p1", text: "Point A", covered: true, coveredAtTurn: 1 },
      { id: "p2", text: "Point B", covered: false },
      { id: "p3", text: "Point C", covered: false },
    ];
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    (service as any).logUncoveredPoints(script);

    expect(warnSpy).toHaveBeenCalledWith(
      "2 discussion point(s) never covered: p2 (Point B), p3 (Point C)"
    );
    warnSpy.mockRestore();
  });

  it("does not warn when every point is covered", () => {
    const service = makeService({});
    const script = makeScript();
    script.discussionPoints = [
      { id: "p1", text: "Point A", covered: true, coveredAtTurn: 1 },
    ];
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    (service as any).logUncoveredPoints(script);

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("ScriptService discussionPoints persistence", () => {
  it("saveScript includes discussionPoints in the created record", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "record-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const service = makeService({ scriptRepository: { create } });
    const script = makeScript();
    script.discussionPoints = [{ id: "p1", text: "Point A", covered: false }];

    await (service as any).saveScript(script);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        discussionPoints: [{ id: "p1", text: "Point A", covered: false }],
      })
    );
  });

  it("persists editorial cards, conversation beats and introduced knowledge with the script", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "record-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const service = makeService({ scriptRepository: { create } });
    const script = makeScript();
    script.editorialCards = [
      {
        id: "m1-card-1",
        materialId: "m1",
        kind: EditorialCardKind.Story,
        content: "A revealing anecdote.",
        significance: "",
        evidence: [],
        relatedCardIds: [],
        tags: [],
        keyTerms: [],
        storyValue: 5,
      },
    ];
    script.conversationBeats = [
      {
        id: "b1",
        purpose: BeatPurpose.Hook,
        goal: "Open with the anecdote.",
        cardIds: ["m1-card-1"],
        prerequisiteBeatIds: [],
        desiredEnergy: EnergyLevel.Curious,
        targetTurns: 1,
        covered: false,
      },
    ];
    script.knowledgeLedger = {
      introducedCards: [
        {
          cardId: "m1-card-1",
          introducedBySpeakerId: "s1",
          introducedAtTurn: 1,
          source: KnowledgeSource.SourceMaterial,
        },
      ],
    };
    script.audienceProfile = AudienceProfile.General;
    script.terminologyLedger = {
      explainedTerms: [
        {
          term: "mycelium",
          plainLanguageMeaning: "the underground fungal network",
          explainedBySpeakerId: "s1",
          explainedAtTurn: 1,
        },
      ],
    };

    await (service as any).saveScript(script);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        editorialCards: script.editorialCards,
        conversationBeats: script.conversationBeats,
        knowledgeLedger: script.knowledgeLedger,
        audienceProfile: AudienceProfile.General,
        terminologyLedger: script.terminologyLedger,
      })
    );
  });

  it("loadScriptFromRecord reads discussionPoints back, defaulting to [] when absent", async () => {
    const speakerRepository = { getById: vi.fn() };
    const materialRepository = { getById: vi.fn() };
    const speechRepository = { getById: vi.fn() };
    const service = makeService({
      speakerRepository,
      materialRepository,
      speechRepository,
    });

    const withPoints = await (service as any).loadScriptFromRecord({
      id: "s1",
      title: "T",
      description: "D",
      speakerIds: [],
      speechIds: [],
      materialIds: [],
      discussionPoints: [{ id: "p1", text: "Point A", covered: true }],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(withPoints.discussionPoints).toEqual([
      { id: "p1", text: "Point A", covered: true },
    ]);

    const withoutPoints = await (service as any).loadScriptFromRecord({
      id: "s2",
      title: "T",
      description: "D",
      speakerIds: [],
      speechIds: [],
      materialIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(withoutPoints.discussionPoints).toEqual([]);
    expect(withoutPoints.knowledgeLedger).toEqual({ introducedCards: [] });
    expect(withoutPoints.audienceProfile).toBe(AudienceProfile.General);
    expect(withoutPoints.terminologyLedger).toEqual({ explainedTerms: [] });
  });
});

describe("ScriptService guidance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    directorAgentConstructorMock.mockClear();
  });

  it("passes guidance to the DirectorAgent constructor and persists it on the script", async () => {
    createPodcastPlanMock.mockResolvedValueOnce(undefined);

    const speaker = {
      id: "s1",
      slug: "speaker-1",
      name: "Speaker 1",
      personality: "curious",
      voice: {
        id: "v1",
        name: "Voice",
        description: "",
        provider: VocalProviderName.ElevenLabs,
        providerId: "p",
        settings: {},
      },
      voiceStyle: "neutral",
      isExpert: false,
    };

    chooseNextSpeakerMock.mockResolvedValueOnce({
      speaker,
      direction: "Wrap up.",
      timeStatus: "",
      forceNearlyOutOfTime: false,
      requestSummary: false,
      isFinalTurn: true,
      turnBrief: undefined,
    });
    speakMock.mockResolvedValueOnce({
      id: "",
      speaker,
      message: "Goodbye.",
      instructions: "calm",
      voice: speaker.voice,
      voiceStyle: "neutral",
      timestamp: new Date(),
      tool: SpeakerAgentToolName.SPEAK,
      stopReason: "stop",
    });

    const scriptRepository = {
      create: vi.fn().mockResolvedValue({
        id: "script-1",
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    };
    const speakerRepository = {
      findBySlug: vi.fn().mockResolvedValue(null),
      getById: vi.fn().mockResolvedValue({
        id: "s1",
        slug: "speaker-1",
        name: "Speaker 1",
        personality: "curious",
        voiceId: "v1",
        voiceStyle: "neutral",
        isExpert: false,
      }),
    };
    const voiceRepository = {
      getById: vi.fn().mockResolvedValue({
        id: "v1",
        name: "Voice",
        description: "",
        provider: VocalProviderName.ElevenLabs,
        providerId: "p",
        settings: {},
      }),
    };
    const speechRepository = {
      create: vi.fn().mockResolvedValue({ id: "speech-1" }),
    };
    const service = makeService({
      scriptRepository,
      speakerRepository,
      voiceRepository,
      speechRepository,
    });

    await service.generateScript({
      title: "Test",
      description: "Desc",
      guidance: "Keep it skeptical of the marketing claims.",
      speakers: [{ id: "s1" } as any],
      materials: [],
      maxTurns: 1,
      maxDuration: 60,
      allocation: "sequential" as any,
    });

    expect(directorAgentConstructorMock).toHaveBeenCalled();
    const [, , guidanceArg] = directorAgentConstructorMock.mock.calls[0];
    expect(guidanceArg).toBe("Keep it skeptical of the marketing claims.");

    const createCall = scriptRepository.create.mock.calls[0][0];
    expect(createCall.guidance).toBe(
      "Keep it skeptical of the marketing claims."
    );
  });

  it("loadScriptFromRecord restores guidance from the record", async () => {
    const speakerRepository = { getById: vi.fn() };
    const materialRepository = { getById: vi.fn() };
    const speechRepository = { getById: vi.fn() };
    const service = makeService({
      speakerRepository,
      materialRepository,
      speechRepository,
    });

    const script = await (service as any).loadScriptFromRecord({
      id: "s1",
      title: "T",
      description: "D",
      guidance: "Keep it skeptical of the marketing claims.",
      speakerIds: [],
      speechIds: [],
      materialIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect(script.guidance).toBe("Keep it skeptical of the marketing claims.");
  });
});
