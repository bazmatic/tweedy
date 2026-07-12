import { LlmMessage, PodcastMaterial } from "../types";
import { BaseAgent } from "./BaseAgent";
import { logger } from "../utils/logger";

const SUMMARY_MAX_TOKENS = 300;
const FALLBACK_CONTENT_LENGTH = 500;

export class MaterialSummarizerAgent extends BaseAgent {
  async summarize(
    material: PodcastMaterial,
    context: { title: string; description: string }
  ): Promise<string> {
    const messages: LlmMessage[] = [
      {
        role: "user" as const,
        content: `You're prepping source material for a podcast titled "${context.title}": ${context.description}.

Summarize the following article with an eye toward what's useful in a spoken conversation — key facts, hooks, interesting angles, things worth debating. 2-3 short paragraphs max.

Title: ${material.title}

${material.content}`,
      },
    ];

    try {
      return await this.callModel(messages, SUMMARY_MAX_TOKENS);
    } catch (error) {
      logger.warn(
        `Failed to summarize material "${material.title}"; falling back to truncated raw content:`,
        error
      );
      return material.content.substring(0, FALLBACK_CONTENT_LENGTH);
    }
  }
}
