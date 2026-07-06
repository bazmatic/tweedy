import * as fs from 'fs-extra';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

export abstract class BaseRepository<T> {
  protected abstract getCollectionPath(): string;
  protected abstract getRecordPath(id: string): string;

  protected async ensureCollectionDirectory(): Promise<void> {
    const collectionPath = this.getCollectionPath();
    await fs.ensureDir(collectionPath);
  }

  protected async getRecord(id: string): Promise<T | null> {
    try {
      const recordPath = this.getRecordPath(id);
      if (!await fs.pathExists(recordPath)) {
        return null;
      }
      const data = await fs.readFile(recordPath, 'utf-8');
      return JSON.parse(data) as T;
    } catch (error) {
      logger.error(`Failed to read record ${id}:`, error);
      return null;
    }
  }

  protected async saveRecord(id: string, record: T): Promise<void> {
    try {
      await this.ensureCollectionDirectory();
      const recordPath = this.getRecordPath(id);
      await fs.writeFile(recordPath, JSON.stringify(record, null, 2));
    } catch (error) {
      logger.error(`Failed to save record ${id}:`, error);
      throw error;
    }
  }

  protected async deleteRecord(id: string): Promise<void> {
    try {
      const recordPath = this.getRecordPath(id);
      if (await fs.pathExists(recordPath)) {
        await fs.remove(recordPath);
      }
    } catch (error) {
      logger.error(`Failed to delete record ${id}:`, error);
      throw error;
    }
  }

  protected async getAllRecords(): Promise<T[]> {
    try {
      const collectionPath = this.getCollectionPath();
      if (!await fs.pathExists(collectionPath)) {
        return [];
      }
      
      const files = await fs.readdir(collectionPath);
      const records: T[] = [];

      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(collectionPath, file);
          const data = await fs.readFile(filePath, 'utf-8');
          records.push(JSON.parse(data) as T);
        }
      }

      return records;
    } catch (error) {
      logger.error('Failed to read all records:', error);
      return [];
    }
  }

  protected generateId(): string {
    return uuidv4();
  }
}

