import { IDocumentProcessor } from '../types';
import { PDFProcessor } from './PDFProcessor';
import { TextProcessor } from './TextProcessor';
import { HTMLProcessor } from './HTMLProcessor';
import { logger } from '../utils/logger';

export class DocumentProcessorFactory {
  private static processors: Map<string, IDocumentProcessor> = new Map();

  static {
    this.processors.set('pdf', new PDFProcessor());
    this.processors.set('txt', new TextProcessor());
    this.processors.set('md', new TextProcessor());
    this.processors.set('html', new HTMLProcessor());
    this.processors.set('htm', new HTMLProcessor());
  }

  static getProcessor(filePath: string): IDocumentProcessor {
    const extension = filePath.split('.').pop()?.toLowerCase() || '';
    const processor = this.processors.get(extension);
    
    if (!processor) {
      throw new Error(`No processor found for file type: ${extension}`);
    }
    
    return processor;
  }

  static getSupportedExtensions(): string[] {
    return Array.from(this.processors.keys());
  }

  static async processDocument(filePath: string): Promise<import('../types').ProcessedDocument> {
    try {
      const processor = this.getProcessor(filePath);
      return await processor.process(filePath);
    } catch (error) {
      logger.error(`Failed to process document ${filePath}:`, error);
      throw error;
    }
  }
}

