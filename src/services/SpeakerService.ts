import { ISpeakerService, Speaker, SpeakerRecord, Voice } from "../types";
import { SpeakerRepository, VoiceRepository } from "../repositories";
import { logger } from "../utils/logger";
import { SpeakerRoleProfileResolver } from "../agents/SpeakerRoleProfileResolver";

export class SpeakerService implements ISpeakerService {
  constructor(
    private readonly speakerRepository: SpeakerRepository,
    private readonly voiceRepository: VoiceRepository,
    private readonly roleProfileResolver = new SpeakerRoleProfileResolver()
  ) {}

  async createSpeaker(
    speaker: Omit<SpeakerRecord, "id" | "slug" | "createdAt" | "updatedAt">
  ): Promise<Speaker> {
    try {
      const voiceRecord = await this.voiceRepository.getById(speaker.voiceId);
      if (!voiceRecord) {
        throw new Error(`Voice with id ${speaker.voiceId} not found`);
      }

      const record = await this.speakerRepository.create(
        speaker,
        voiceRecord.provider
      );
      return await this.populateSpeakerWithVoice(record);
    } catch (error) {
      logger.error("Failed to create speaker:", error);
      throw error;
    }
  }

  async getSpeaker(id: string): Promise<Speaker> {
    const record = await this.speakerRepository.getById(id);
    if (!record) {
      throw new Error(`Speaker with id ${id} not found`);
    }
    return await this.populateSpeakerWithVoice(record);
  }

  async getSpeakerBySlug(slug: string): Promise<Speaker> {
    const record = await this.speakerRepository.findBySlug(slug);
    if (!record) {
      throw new Error(`Speaker with slug ${slug} not found`);
    }
    return await this.populateSpeakerWithVoice(record);
  }

  async getAllSpeakers(): Promise<Speaker[]> {
    const records = await this.speakerRepository.getAll();
    const speakers: Speaker[] = [];

    for (const record of records) {
      try {
        const speaker = await this.populateSpeakerWithVoice(record);
        speakers.push(speaker);
      } catch (error) {
        logger.warn(`Failed to populate speaker ${record.id}:`, error);
      }
    }

    return speakers;
  }

  async updateSpeaker(
    id: string,
    speaker: Partial<Omit<SpeakerRecord, "id" | "createdAt" | "updatedAt">>
  ): Promise<Speaker> {
    const record = await this.speakerRepository.update(id, speaker);
    if (!record) {
      throw new Error(`Speaker with id ${id} not found`);
    }
    return await this.populateSpeakerWithVoice(record);
  }

  async deleteSpeaker(id: string): Promise<void> {
    const deleted = await this.speakerRepository.delete(id);
    if (!deleted) {
      throw new Error(`Speaker with id ${id} not found`);
    }
  }

  private async populateSpeakerWithVoice(
    record: SpeakerRecord
  ): Promise<Speaker> {
    const voiceRecord = await this.voiceRepository.getById(record.voiceId);
    if (!voiceRecord) {
      throw new Error(
        `Voice with id ${record.voiceId} not found for speaker ${record.name}`
      );
    }

    const voice: Voice = {
      id: voiceRecord.id,
      name: voiceRecord.name,
      description: voiceRecord.description,
      provider: voiceRecord.provider,
      providerId: voiceRecord.providerId,
      settings: voiceRecord.settings,
    };

    return {
      id: record.id,
      slug: record.slug,
      name: record.name,
      personality: record.personality,
      voice,
      voiceStyle: record.voiceStyle,
      isExpert: record.isExpert,
      roleProfile: this.roleProfileResolver.resolve(record),
      mannerisms: record.mannerisms,
      physicalAppearance: record.physicalAppearance,
    };
  }
}
