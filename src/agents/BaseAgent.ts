import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger';

export abstract class BaseAgent {
  protected client: Anthropic;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required');
    }
    this.client = new Anthropic({ apiKey });
  }

  protected async callClaude(messages: any[], maxTokens: number = 1000): Promise<string> {
    try {
      const response = await this.client.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: maxTokens,
        messages,
      });

      return response.content[0].type === 'text' ? response.content[0].text : '';
    } catch (error) {
      logger.error('Claude API call failed:', error);
      throw error;
    }
  }

  protected logAgentAction(action: string, details?: any): void {
    logger.debug(`Agent action: ${action}`, details);
  }
}
