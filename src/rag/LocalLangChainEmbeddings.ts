import { Embeddings } from "@langchain/core/embeddings";
import { embedText, embedTexts } from "./local-embeddings";

export class LocalLangChainEmbeddings extends Embeddings {
  constructor() {
    super({});
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    return embedTexts(documents);
  }

  async embedQuery(text: string): Promise<number[]> {
    return embedText(text);
  }
}
