import * as path from "path";
import { createHash } from "crypto";
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

  async createOrReturn(
    speech: Omit<SpeechRecord, "id" | "idempotencyKey">,
    idempotencyKey: string
  ): Promise<SpeechRecord> {
    const existing = await this.getByIdempotencyKey(idempotencyKey);
    if (existing) return existing;
    // Deriving the record id closes the race between two concurrent replays:
    // both writers target the same record path, so a duplicate cannot appear.
    const record: SpeechRecord = {
      ...speech,
      idempotencyKey,
      id: `turn-${createHash("sha256").update(idempotencyKey).digest("hex")}`,
    };
    await this.saveRecord(record.id, record);
    return record;
  }

  async getByIdempotencyKey(idempotencyKey: string): Promise<SpeechRecord | null> {
    const records = await this.getAllRecords();
    return records.find((record) => record.idempotencyKey === idempotencyKey) ?? null;
  }

  /**
   * Removes only a workflow-created record that never became accepted.
   * Records without this key and accepted records are never cleanup targets.
   */
  async deleteUnaccepted(
    idempotencyKey: string,
    acceptedSpeechIds: readonly string[]
  ): Promise<boolean> {
    const record = await this.getByIdempotencyKey(idempotencyKey);
    if (!record || acceptedSpeechIds.includes(record.id)) return false;
    await this.deleteRecord(record.id);
    return true;
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
