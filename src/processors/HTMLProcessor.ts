import * as fs from 'fs-extra';
import * as cheerio from 'cheerio';
import axios from 'axios';
import { BaseProcessor } from './BaseProcessor';
import { ProcessedDocument } from '../types';
import { logger } from '../utils/logger';

export class HTMLProcessor extends BaseProcessor {
  protected getSupportedExtensions(): string[] {
    return ['html', 'htm'];
  }

  async process(filePath: string): Promise<ProcessedDocument> {
    try {
      this.validateFile(filePath);
      
      let html: string;
      
      // Check if it's a URL or file path
      if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
        const response = await axios.get(filePath);
        html = response.data;
      } else {
        html = await fs.readFile(filePath, 'utf-8');
      }
      
      const $ = cheerio.load(html);
      
      // Remove script and style elements
      $('script, style, nav, header, footer').remove();
      
      // Extract main content
      const title = $('title').text() || $('h1').first().text() || this.getFileName(filePath);
      const content = $('body').text().replace(/\s+/g, ' ').trim();
      
      const metadata = {
        filePath,
        url: filePath.startsWith('http') ? filePath : undefined,
        title: $('title').text(),
        description: $('meta[name="description"]').attr('content'),
        author: $('meta[name="author"]').attr('content'),
        keywords: $('meta[name="keywords"]').attr('content'),
        fileSize: html.length,
      };

      logger.info(`Processed HTML: ${title}`);
      
      return {
        title,
        content,
        metadata,
      };
    } catch (error) {
      logger.error(`Failed to process HTML ${filePath}:`, error);
      throw error;
    }
  }
}
