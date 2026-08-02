import * as path from 'path';
import { BaseRepository } from './BaseRepository';
import { CardHyperedge } from '../types';
import { appConfig } from '../utils/config';

export class CardGraphRepository extends BaseRepository<CardHyperedge> {
  protected getCollectionPath(): string {
    return path.join(appConfig.dataDir, 'card-graph');
  }

  protected getRecordPath(id: string): string {
    return path.join(this.getCollectionPath(), `${id}.json`);
  }

  async create(edge: Omit<CardHyperedge, 'id'>): Promise<CardHyperedge> {
    const record: CardHyperedge = { ...edge, id: this.generateId() };
    await this.saveRecord(record.id, record);
    return record;
  }

  async findByCardId(scriptId: string, cardId: string): Promise<CardHyperedge[]> {
    const all = await this.getAllRecords();
    return all.filter(
      (edge) => edge.scriptId === scriptId && edge.cardIds.includes(cardId)
    );
  }

  async findByScriptId(scriptId: string): Promise<CardHyperedge[]> {
    const all = await this.getAllRecords();
    return all.filter((edge) => edge.scriptId === scriptId);
  }
}
