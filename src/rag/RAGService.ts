import { VectorStore, EmbeddingService, Document, PodcastMaterial } from '../types';
import { LangChainVectorStore } from './VectorStore';
import { LangChainEmbeddingService } from './EmbeddingService';
import { logger } from '../utils/logger';

export class RAGService {
  private vectorStore: VectorStore;
  private embeddingService: EmbeddingService;

  constructor() {
    this.vectorStore = new LangChainVectorStore();
    this.embeddingService = new LangChainEmbeddingService();
  }

  async addMaterials(materials: PodcastMaterial[]): Promise<void> {
    try {
      const documents: Document[] = materials.map(material => ({
        id: material.id,
        content: material.content,
        metadata: {
          title: material.title,
          source: material.source,
          sourceType: material.sourceType,
          ...material.metadata,
        },
      }));

      await this.vectorStore.addDocuments(documents);
      logger.info(`Added ${materials.length} materials to RAG system`);
    } catch (error) {
      logger.error('Failed to add materials to RAG system:', error);
      throw error;
    }
  }

  async searchRelevantContent(query: string, limit: number = 5): Promise<Document[]> {
    try {
      const results = await this.vectorStore.similaritySearch(query, limit);
      logger.debug(`Found ${results.length} relevant documents for query: ${query}`);
      return results;
    } catch (error) {
      logger.error('Failed to search relevant content:', error);
      throw error;
    }
  }

  async getContextForQuery(query: string, limit: number = 5): Promise<string> {
    try {
      const relevantDocs = await this.searchRelevantContent(query, limit);
      
      if (relevantDocs.length === 0) {
        return 'No relevant context found.';
      }

      const context = relevantDocs
        .map((doc, index) => `[${index + 1}] ${doc.content}`)
        .join('\n\n');

      return `Relevant context:\n${context}`;
    } catch (error) {
      logger.error('Failed to get context for query:', error);
      throw error;
    }
  }

  async clearStore(): Promise<void> {
    try {
      // Note: This would need to be implemented based on the specific vector store
      logger.warn('Clear store not implemented for current vector store');
    } catch (error) {
      logger.error('Failed to clear store:', error);
      throw error;
    }
  }
}
