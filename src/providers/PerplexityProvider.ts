import axios from "axios";
import { IResearchProvider, ResearchMaterial, ResearchOptions, SourceType } from "../types";
import { HTMLProcessor } from "../processors";
import { logger } from "../utils/logger";

const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";

interface PerplexityResult {
  answer: string;
  citations: string[];
  relatedQuestions: string[];
  usage: unknown;
}

export class PerplexityProvider implements IResearchProvider {
  private readonly apiKey: string;

  constructor() {
    const apiKey = process.env.PERPLEXITY_API_KEY;
    if (!apiKey) {
      throw new Error("PERPLEXITY_API_KEY environment variable is required");
    }
    this.apiKey = apiKey;
  }

  async research(query: string, options: ResearchOptions = {}): Promise<ResearchMaterial[]> {
    const followUpQueries = options.followUpQueries ?? 0;

    const primary = await this.query(query);
    const queriesUsed = [query];
    const results = [{ query, result: primary }];

    for (const followUp of primary.relatedQuestions.slice(0, followUpQueries)) {
      if (queriesUsed.includes(followUp)) continue;
      queriesUsed.push(followUp);
      try {
        const result = await this.query(followUp);
        results.push({ query: followUp, result });
      } catch (error) {
        logger.warn(`Failed to research follow-up query "${followUp}", skipping:`, error);
      }
    }

    const materials: ResearchMaterial[] = results.map(({ query: q, result }) => ({
      title: q,
      content: result.answer,
      source: "perplexity",
      sourceType: SourceType.Research,
      metadata: { citations: result.citations, usage: result.usage },
    }));

    const seenCitations = new Set<string>();
    const htmlProcessor = new HTMLProcessor();
    for (const { result } of results) {
      for (const url of result.citations) {
        if (seenCitations.has(url)) continue;
        seenCitations.add(url);
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
    }

    return materials;
  }

  private async query(query: string): Promise<PerplexityResult> {
    let response;
    try {
      response = await axios.post(
        PERPLEXITY_API_URL,
        {
          model: "sonar-pro",
          messages: [{ role: "user", content: query }],
          web_search_options: { search_context_size: "high" },
          return_related_questions: true,
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

    return {
      answer: response.data.choices[0].message.content,
      citations: response.data.citations || [],
      relatedQuestions: response.data.related_questions || [],
      usage: response.data.usage,
    };
  }
}
