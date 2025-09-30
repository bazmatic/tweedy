import { IVoiceService, Voice, VoiceRecord } from "../types";
import { VoiceRepository } from "../repositories";
import { logger } from "../utils/logger";

export class VoiceService implements IVoiceService {
  constructor(private readonly voiceRepository: VoiceRepository) {}

  async createVoice(
    voice: Omit<VoiceRecord, "id" | "createdAt" | "updatedAt">
  ): Promise<Voice> {
    try {
      const record = await this.voiceRepository.create(voice);
      return this.mapRecordToVoice(record);
    } catch (error) {
      logger.error("Failed to create voice:", error);
      throw error;
    }
  }

  async getVoice(id: string): Promise<Voice> {
    const record = await this.voiceRepository.getById(id);
    if (!record) {
      throw new Error(`Voice with id ${id} not found`);
    }
    return this.mapRecordToVoice(record);
  }

  async getAllVoices(): Promise<Voice[]> {
    const records = await this.voiceRepository.getAll();
    return records.map((record) => this.mapRecordToVoice(record));
  }

  async updateVoice(
    id: string,
    voice: Partial<Omit<VoiceRecord, "id" | "createdAt" | "updatedAt">>
  ): Promise<Voice> {
    const record = await this.voiceRepository.update(id, voice);
    if (!record) {
      throw new Error(`Voice with id ${id} not found`);
    }
    return this.mapRecordToVoice(record);
  }

  async deleteVoice(id: string): Promise<void> {
    const deleted = await this.voiceRepository.delete(id);
    if (!deleted) {
      throw new Error(`Voice with id ${id} not found`);
    }
  }

  private mapRecordToVoice(record: VoiceRecord): Voice {
    return {
      id: record.id,
      name: record.name,
      description: record.description,
      provider: record.provider,
      providerId: record.providerId,
      settings: record.settings,
    };
  }
}
