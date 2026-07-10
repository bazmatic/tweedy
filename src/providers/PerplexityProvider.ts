import axios from "axios";
import { IResearchProvider, ResearchMaterial, SourceType } from "../types";
import { HTMLProcessor } from "../processors";
import { logger } from "../utils/logger";

const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";

export class PerplexityProvider implements IResearchProvider {
  private readonly apiKey: string;

  constructor() {
    const apiKey = process.env.PERPLEXITY_API_KEY;
    if (!apiKey) {
      throw new Error("PERPLEXITY_API_KEY environment variable is required");
    }
    this.apiKey = apiKey;
  }

  async research(query: string): Promise<ResearchMaterial[]> {
    let response;
    try {
      response = await axios.post(
        PERPLEXITY_API_URL,
        {
          model: "sonar",
          messages: [{ role: "user", content: query }],
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );
    } catch (error) {
      throw new Error(
        `Perplexity API request failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const answer: string = response.data.choices[0].message.content;
    const citations: string[] = response.data.citations || [];

    const materials: ResearchMaterial[] = [
      {
        title: query,
        content: answer,
        source: "perplexity",
        sourceType: SourceType.Research,
        metadata: { citations, usage: response.data.usage },
      },
    ];

    const htmlProcessor = new HTMLProcessor();
    for (const url of citations) {
      try {
        const processed = await htmlProcessor.process(url);
        materials.push({
          title: processed.title,
          content: processed.content,
          source: url,
          sourceType: SourceType.Web,
          metadata: processed.metadata,
        });
      } catch (error) {
        logger.warn(`Failed to fetch citation ${url}, skipping:`, error);
      }
    }

    return materials;
  }
}
