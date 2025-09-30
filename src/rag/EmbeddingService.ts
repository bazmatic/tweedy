import { OpenAIEmbeddings } from "@langchain/openai";
import { EmbeddingService } from "../types";
import { appConfig } from "../utils/config";
import { logger } from "../utils/logger";

export class LangChainEmbeddingService implements EmbeddingService {
  private embeddings?: OpenAIEmbeddings;

  constructor() {
    // Delay initialization until first use
  }

  private ensureInitialized(): void {
    if (!this.embeddings) {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error(
          "OPENAI_API_KEY environment variable is required for embedding functionality"
        );
      }
      this.embeddings = new OpenAIEmbeddings({
        modelName: appConfig.defaultEmbeddingModel,
        openAIApiKey: process.env.OPENAI_API_KEY!,
      });
    }
  }

  async embedText(text: string): Promise<number[]> {
    try {
      this.ensureInitialized();
      const result = await this.embeddings!.embedQuery(text);
      return result;
    } catch (error) {
      logger.error("Failed to embed text:", error);
      throw error;
    }
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    try {
      this.ensureInitialized();
      const results = await this.embeddings!.embedDocuments(documents);
      return results;
    } catch (error) {
      logger.error("Failed to embed documents:", error);
      throw error;
    }
  }
}
