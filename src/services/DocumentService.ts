import { DocumentProcessorFactory } from "../processors";
import { MaterialService } from "./MaterialService";
import { SourceType } from "../types";
import { logger } from "../utils/logger";

export interface IDocumentService {
  processDocument(filePath: string, title?: string): Promise<void>;
  processWebPage(url: string, title?: string): Promise<void>;
  processFolder(folderPath: string): Promise<void>;
}

export class DocumentService implements IDocumentService {
  constructor(private readonly materialService: MaterialService) {}

  async processDocument(filePath: string, title?: string): Promise<void> {
    try {
      logger.info(`Processing document: ${filePath}`);

      const processedDoc = await DocumentProcessorFactory.processDocument(
        filePath
      );

      await this.materialService.addMaterial({
        title: title || processedDoc.title,
        content: processedDoc.content,
        source: filePath,
        sourceType: this.getSourceTypeFromPath(filePath),
        metadata: processedDoc.metadata,
      });

      logger.success(`Document processed: ${processedDoc.title}`);
    } catch (error) {
      logger.error(`Failed to process document ${filePath}:`, error);
      throw error;
    }
  }

  async processWebPage(url: string, title?: string): Promise<void> {
    try {
      logger.info(`Processing web page: ${url}`);

      const processedDoc = await DocumentProcessorFactory.processDocument(url);

      await this.materialService.addMaterial({
        title: title || processedDoc.title,
        content: processedDoc.content,
        source: url,
        sourceType: SourceType.Web,
        metadata: processedDoc.metadata,
      });

      logger.success(`Web page processed: ${processedDoc.title}`);
    } catch (error) {
      logger.error(`Failed to process web page ${url}:`, error);
      throw error;
    }
  }

  async processFolder(folderPath: string): Promise<void> {
    try {
      logger.info(`Processing folder: ${folderPath}`);

      const fs = require("fs-extra");
      const path = require("path");

      const files = await fs.readdir(folderPath);
      const supportedExtensions =
        DocumentProcessorFactory.getSupportedExtensions();

      let processedCount = 0;

      for (const file of files) {
        const filePath = path.join(folderPath, file);
        const stat = await fs.stat(filePath);

        if (stat.isFile()) {
          const extension = path.extname(file).toLowerCase().substring(1);

          if (supportedExtensions.includes(extension)) {
            try {
              await this.processDocument(filePath);
              processedCount++;
            } catch (error) {
              logger.warn(`Failed to process file ${file}:`, error);
            }
          }
        }
      }

      logger.success(`Processed ${processedCount} files from folder`);
    } catch (error) {
      logger.error(`Failed to process folder ${folderPath}:`, error);
      throw error;
    }
  }

  private getSourceTypeFromPath(filePath: string): SourceType {
    const extension = filePath.split(".").pop()?.toLowerCase();

    switch (extension) {
      case "pdf":
      case "txt":
      case "md":
      case "html":
      case "htm":
        return SourceType.Document;
      default:
        return SourceType.Document;
    }
  }
}
