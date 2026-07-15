import { describe, expect, it, vi } from "vitest";
import {
  EpistemicRole,
  SourceAccess,
  UncertaintyStyle,
  VocalProviderName,
} from "../types";
import { SpeakerService } from "./SpeakerService";
import { SpeakerRepository, VoiceRepository } from "../repositories";

const voiceRecord = {
  id: "voice-1",
  name: "Voice",
  description: "",
  provider: VocalProviderName.ElevenLabs,
  providerId: "provider-id",
  settings: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeRecord(isExpert: boolean) {
  return {
    id: "speaker-1",
    slug: "speaker-1",
    name: "Speaker",
    personality: "curious",
    voiceId: voiceRecord.id,
    voiceStyle: "natural",
    isExpert,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("SpeakerService role-profile migration", () => {
  it("loads a legacy expert record with an explicit resolved profile", async () => {
    const speakerRepository = {
      getById: vi.fn().mockResolvedValue(makeRecord(true)),
    };
    const voiceRepository = {
      getById: vi.fn().mockResolvedValue(voiceRecord),
    };
    const service = new SpeakerService(
      speakerRepository as unknown as SpeakerRepository,
      voiceRepository as unknown as VoiceRepository
    );

    const speaker = await service.getSpeaker("speaker-1");

    expect(speaker.roleProfile).toEqual({
      epistemicRole: EpistemicRole.Expert,
      sourceAccess: SourceAccess.Full,
      uncertaintyStyle: UncertaintyStyle.Precise,
    });
  });
});

describe("SpeakerService physicalAppearance", () => {
  it("passes physicalAppearance through from the record to the populated speaker", async () => {
    const speakerRepository = {
      getById: vi.fn().mockResolvedValue({
        ...makeRecord(false),
        physicalAppearance: "Woman in her 40s, curly red hair, glasses",
      }),
    };
    const voiceRepository = {
      getById: vi.fn().mockResolvedValue(voiceRecord),
    };
    const service = new SpeakerService(
      speakerRepository as unknown as SpeakerRepository,
      voiceRepository as unknown as VoiceRepository
    );

    const speaker = await service.getSpeaker("speaker-1");

    expect(speaker.physicalAppearance).toBe(
      "Woman in her 40s, curly red hair, glasses"
    );
  });

  it("leaves physicalAppearance undefined when not set on the record", async () => {
    const speakerRepository = {
      getById: vi.fn().mockResolvedValue(makeRecord(false)),
    };
    const voiceRepository = {
      getById: vi.fn().mockResolvedValue(voiceRecord),
    };
    const service = new SpeakerService(
      speakerRepository as unknown as SpeakerRepository,
      voiceRepository as unknown as VoiceRepository
    );

    const speaker = await service.getSpeaker("speaker-1");

    expect(speaker.physicalAppearance).toBeUndefined();
  });
});
