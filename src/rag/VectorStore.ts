import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { LocalLangChainEmbeddings } from "./LocalLangChainEmbeddings";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Document } from "@langchain/core/documents";
import * as fs from "fs-extra";
import * as path from "path";
import {
  VectorStore,
  Document as CustomDocument,
  EmbeddingService,
} from "../types";
import { appConfig } from "../utils/config";
import { logger } from "../utils/logger";

export class LangChainVectorStore implements VectorStore {
  private vectorStore?: MemoryVectorStore;
  private embeddings?: LocalLangChainEmbeddings;
  private textSplitter: RecursiveCharacterTextSplitter;
  private storePath: string;

  constructor() {
    this.textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: appConfig.defaultChunkSize,
      chunkOverlap: appConfig.defaultChunkOverlap,
    });

    this.storePath = path.join(appConfig.embeddingsDir, "vectorstore.json");
  }

  private ensureInitialized(): void {
    if (!this.embeddings) {
      this.embeddings = new LocalLangChainEmbeddings();
      this.vectorStore = new MemoryVectorStore(this.embeddings);
    }
  }

  async addDocuments(documents: CustomDocument[]): Promise<void> {
    try {
      this.ensureInitialized();

      const langchainDocs = documents.map(
        (doc) =>
          new Document({
            pageContent: doc.content,
            metadata: {
              id: doc.id,
              ...doc.metadata,
            },
          })
      );

      const splitDocs = await this.textSplitter.splitDocuments(langchainDocs);
      await this.vectorStore!.addDocuments(splitDocs);

      // Persist the vector store
      await this.persistStore();

      logger.info(`Added ${documents.length} documents to vector store`);
    } catch (error) {
      logger.error("Failed to add documents to vector store:", error);
      throw error;
    }
  }

  async similaritySearch(
    query: string,
    k: number = 5
  ): Promise<CustomDocument[]> {
    try {
      this.ensureInitialized();

      const results = await this.vectorStore!.similaritySearch(query, k);

      return results.map((doc) => ({
        id: doc.metadata.id || "",
        content: doc.pageContent,
        metadata: doc.metadata,
      }));
    } catch (error) {
      logger.error("Failed to perform similarity search:", error);
      throw error;
    }
  }

  async deleteDocuments(ids: string[]): Promise<void> {
    try {
      // Note: MemoryVectorStore doesn't support deletion directly
      // This would require rebuilding the store without the specified documents
      logger.warn(
        "Document deletion not fully supported with MemoryVectorStore"
      );
    } catch (error) {
      logger.error("Failed to delete documents:", error);
      throw error;
    }
  }

  private async persistStore(): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(this.storePath));
      // Note: MemoryVectorStore doesn't have built-in persistence
      // This is a placeholder for future implementation with a persistent store
      logger.debug(
        "Vector store persistence not implemented for MemoryVectorStore"
      );
    } catch (error) {
      logger.error("Failed to persist vector store:", error);
      throw error;
    }
  }

  async loadStore(): Promise<void> {
    try {
      if (await fs.pathExists(this.storePath)) {
        // Note: MemoryVectorStore doesn't have built-in loading
        // This is a placeholder for future implementation
        logger.debug(
          "Vector store loading not implemented for MemoryVectorStore"
        );
      }
    } catch (error) {
      logger.error("Failed to load vector store:", error);
      throw error;
    }
  }
}
