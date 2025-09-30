import * as path from 'path';
import { BaseRepository } from './BaseRepository';
import { ScriptRecord, IScriptRepository } from '../types';
import { appConfig } from '../utils/config';

export class ScriptRepository extends BaseRepository<ScriptRecord> implements IScriptRepository {
  protected getCollectionPath(): string {
    return path.join(appConfig.scriptsDir);
  }

  protected getRecordPath(id: string): string {
    return path.join(this.getCollectionPath(), `${id}.json`);
  }

  async create(script: Omit<ScriptRecord, "id" | "createdAt" | "updatedAt">): Promise<ScriptRecord> {
    const now = new Date();
    const record: ScriptRecord = {
      ...script,
      id: this.generateId(),
      createdAt: now,
      updatedAt: now,
    };

    await this.saveRecord(record.id, record);
    return record;
  }

  async getById(id: string): Promise<ScriptRecord | null> {
    return await this.getRecord(id);
  }

  async getAll(): Promise<ScriptRecord[]> {
    return await this.getAllRecords();
  }

  async update(id: string, script: Partial<Omit<ScriptRecord, "id" | "createdAt" | "updatedAt">>): Promise<ScriptRecord | null> {
    const existing = await this.getRecord(id);
    if (!existing) {
      return null;
    }

    const updated: ScriptRecord = {
      ...existing,
      ...script,
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

  async findByName(name: string): Promise<ScriptRecord | null> {
    const scripts = await this.getAll();
    return scripts.find(script => script.title === name) || null;
  }
}
