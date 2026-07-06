import * as path from 'path';
import { BaseRepository } from './BaseRepository';
import { SpeakerRecord, ISpeakerRepository } from '../types';
import { appConfig } from '../utils/config';

export class SpeakerRepository extends BaseRepository<SpeakerRecord> implements ISpeakerRepository {
  protected getCollectionPath(): string {
    return path.join(appConfig.dataDir, 'speakers');
  }

  protected getRecordPath(id: string): string {
    return path.join(this.getCollectionPath(), `${id}.json`);
  }

  async create(speaker: Omit<SpeakerRecord, "id" | "createdAt" | "updatedAt">): Promise<SpeakerRecord> {
    const now = new Date();
    const record: SpeakerRecord = {
      ...speaker,
      id: this.generateId(),
      createdAt: now,
      updatedAt: now,
    };

    await this.saveRecord(record.id, record);
    return record;
  }

  async getById(id: string): Promise<SpeakerRecord | null> {
    return await this.getRecord(id);
  }

  async getAll(): Promise<SpeakerRecord[]> {
    return await this.getAllRecords();
  }

  async update(id: string, speaker: Partial<Omit<SpeakerRecord, "id" | "createdAt" | "updatedAt">>): Promise<SpeakerRecord | null> {
    const existing = await this.getRecord(id);
    if (!existing) {
      return null;
    }

    const updated: SpeakerRecord = {
      ...existing,
      ...speaker,
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

  async findByName(name: string): Promise<SpeakerRecord | null> {
    const speakers = await this.getAll();
    return speakers.find(speaker => speaker.name === name) || null;
  }
}

