import { EmbeddingService } from '../types';
import { embedText, embedTexts } from './local-embeddings';

export class LocalEmbeddingService implements EmbeddingService {
  async embedText(text: string): Promise<number[]> {
    return embedText(text);
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    return embedTexts(documents);
  }
}
