import * as path from 'path';
import { BaseRepository } from './BaseRepository';
import { MaterialRecord, IMaterialRepository, SourceType } from '../types';
import { appConfig } from '../utils/config';

export class MaterialRepository extends BaseRepository<MaterialRecord> implements IMaterialRepository {
  protected getCollectionPath(): string {
    return path.join(appConfig.dataDir, 'materials');
  }

  protected getRecordPath(id: string): string {
    return path.join(this.getCollectionPath(), `${id}.json`);
  }

  async create(material: Omit<MaterialRecord, "id" | "createdAt">): Promise<MaterialRecord> {
    const now = new Date();
    const record: MaterialRecord = {
      ...material,
      id: this.generateId(),
      createdAt: now,
    };

    await this.saveRecord(record.id, record);
    return record;
  }

  async getById(id: string): Promise<MaterialRecord | null> {
    return await this.getRecord(id);
  }

  async getAll(): Promise<MaterialRecord[]> {
    return await this.getAllRecords();
  }

  async update(id: string, material: Partial<Omit<MaterialRecord, "id" | "createdAt">>): Promise<MaterialRecord | null> {
    const existing = await this.getRecord(id);
    if (!existing) {
      return null;
    }

    const updated: MaterialRecord = {
      ...existing,
      ...material,
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

  async findBySource(source: string): Promise<MaterialRecord[]> {
    const materials = await this.getAll();
    return materials.filter(material => material.source === source);
  }

  async findBySourceType(sourceType: SourceType): Promise<MaterialRecord[]> {
    const materials = await this.getAll();
    return materials.filter(material => material.sourceType === sourceType);
  }
}

