import * as path from "path";
import { BaseRepository } from "./BaseRepository";
import { SpeechRecord, ISpeechRepository } from "../types";
import { appConfig } from "../utils/config";

export class SpeechRepository
  extends BaseRepository<SpeechRecord>
  implements ISpeechRepository
{
  protected getCollectionPath(): string {
    return path.join(appConfig.dataDir, "speeches");
  }

  protected getRecordPath(id: string): string {
    return path.join(this.getCollectionPath(), `${id}.json`);
  }

  async create(speech: Omit<SpeechRecord, "id">): Promise<SpeechRecord> {
    const record: SpeechRecord = {
      ...speech,
      id: this.generateId(),
    };

    await this.saveRecord(record.id, record);
    return record;
  }

  async getById(id: string): Promise<SpeechRecord | null> {
    return await this.getRecord(id);
  }

  async getAll(): Promise<SpeechRecord[]> {
    return await this.getAllRecords();
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.getRecord(id);
    if (!existing) {
      return false;
    }

    await this.deleteRecord(id);
    return true;
  }
}

