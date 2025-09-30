import * as path from 'path';
import { BaseRepository } from './BaseRepository';
import { VoiceRecord, IVoiceRepository } from '../types';
import { appConfig } from '../utils/config';

export class VoiceRepository extends BaseRepository<VoiceRecord> implements IVoiceRepository {
  protected getCollectionPath(): string {
    return path.join(appConfig.dataDir, 'voices');
  }

  protected getRecordPath(id: string): string {
    return path.join(this.getCollectionPath(), `${id}.json`);
  }

  async create(voice: Omit<VoiceRecord, "id" | "createdAt" | "updatedAt">): Promise<VoiceRecord> {
    const now = new Date();
    const record: VoiceRecord = {
      ...voice,
      id: this.generateId(),
      createdAt: now,
      updatedAt: now,
    };

    await this.saveRecord(record.id, record);
    return record;
  }

  async getById(id: string): Promise<VoiceRecord | null> {
    return await this.getRecord(id);
  }

  async getAll(): Promise<VoiceRecord[]> {
    return await this.getAllRecords();
  }

  async update(id: string, voice: Partial<Omit<VoiceRecord, "id" | "createdAt" | "updatedAt">>): Promise<VoiceRecord | null> {
    const existing = await this.getRecord(id);
    if (!existing) {
      return null;
    }

    const updated: VoiceRecord = {
      ...existing,
      ...voice,
      updatedAt: new Date(),
    };

    await this.saveRecord(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.getRecord(id);
    if (!existing) {
      return false;
    }

    await this.deleteRecord(id);
    return true;
  }

  async findByName(name: string): Promise<VoiceRecord | null> {
    const voices = await this.getAll();
    return voices.find(voice => voice.name === name) || null;
  }
}
