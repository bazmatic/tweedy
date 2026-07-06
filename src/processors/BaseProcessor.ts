import { IDocumentProcessor, ProcessedDocument } from '../types';
import { logger } from '../utils/logger';

export abstract class BaseProcessor implements IDocumentProcessor {
  protected abstract getSupportedExtensions(): string[];

  abstract process(filePath: string): Promise<ProcessedDocument>;

  protected validateFile(filePath: string): void {
    const extension = this.getFileExtension(filePath);
    const supportedExtensions = this.getSupportedExtensions();
    
    if (!supportedExtensions.includes(extension)) {
      throw new Error(`Unsupported file type: ${extension}. Supported types: ${supportedExtensions.join(', ')}`);
    }
  }

  protected getFileExtension(filePath: string): string {
    return filePath.split('.').pop()?.toLowerCase() || '';
  }

  protected getFileName(filePath: string): string {
    return filePath.split('/').pop()?.split('.')[0] || 'unknown';
  }
}

