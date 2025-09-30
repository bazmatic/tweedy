import * as fs from "fs-extra";
import pdf from "pdf-parse";
import { BaseProcessor } from "./BaseProcessor";
import { ProcessedDocument } from "../types";
import { logger } from "../utils/logger";

export class PDFProcessor extends BaseProcessor {
  protected getSupportedExtensions(): string[] {
    return ["pdf"];
  }

  async process(filePath: string): Promise<ProcessedDocument> {
    try {
      this.validateFile(filePath);

      const buffer = await fs.readFile(filePath);
      const data = await pdf(buffer);

      const title = this.getFileName(filePath);
      const content = data.text;
      const metadata = {
        pages: data.numpages,
        info: data.info,
        version: data.version,
        filePath,
        fileSize: buffer.length,
      };

      logger.info(`Processed PDF: ${title} (${data.numpages} pages)`);

      return {
        title,
        content,
        metadata,
      };
    } catch (error) {
      logger.error(`Failed to process PDF ${filePath}:`, error);
      throw error;
    }
  }
}
