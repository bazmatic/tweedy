import * as fs from 'fs-extra';
import { BaseProcessor } from './BaseProcessor';
import { ProcessedDocument } from '../types';
import { logger } from '../utils/logger';

export class TextProcessor extends BaseProcessor {
  protected getSupportedExtensions(): string[] {
    return ['txt', 'md'];
  }

  async process(filePath: string): Promise<ProcessedDocument> {
    try {
      this.validateFile(filePath);
      
      const content = await fs.readFile(filePath, 'utf-8');
      const title = this.getFileName(filePath);
      const stats = await fs.stat(filePath);
      
      const metadata = {
        filePath,
        fileSize: stats.size,
        extension: this.getFileExtension(filePath),
        lastModified: stats.mtime,
      };

      logger.info(`Processed text file: ${title}`);
      
      return {
        title,
        content,
        metadata,
      };
    } catch (error) {
      logger.error(`Failed to process text file ${filePath}:`, error);
      throw error;
    }
  }
}
