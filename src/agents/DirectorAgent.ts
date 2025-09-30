import { IDirectorAgent, PodcastScript, ISpeakerAgent } from '../types';
import { BaseAgent } from './BaseAgent';
import { logger } from '../utils/logger';

export class DirectorAgent extends BaseAgent implements IDirectorAgent {
  private script: PodcastScript;
  private podcastPlan: string = '';

  constructor(script: PodcastScript) {
    super();
    this.script = script;
  }

  async createPodcastPlan(): Promise<string> {
    try {
      this.logAgentAction('Creating podcast plan');

      const materialText = this.script.materials
        .map(material => `${material.title}: ${material.content}`)
        .join('\n\n');

      const messages = [
        {
          role: 'user' as const,
          content: `You are a podcast director. Create a plan for a podcast episode with the following details:

Title: ${this.script.title}
Description: ${this.script.description}
Duration: Approximately ${this.script.speeches.length * 2} minutes
Speakers: ${this.script.speakers.map(s => s.name).join(', ')}

Available materials:
${materialText}

Create a detailed plan for how the conversation should flow, including:
1. Opening segment
2. Main discussion points
3. Key topics to cover
4. Closing segment

Keep it engaging and natural, with clear direction for each speaker.`
        }
      ];

      this.podcastPlan = await this.callClaude(messages, 800);
      logger.info('Podcast plan created successfully');
      
      return this.podcastPlan;
    } catch (error) {
      logger.error('Failed to create podcast plan:', error);
      throw error;
    }
  }

  async giveDirection(speakerAgent: ISpeakerAgent): Promise<string> {
    try {
      this.logAgentAction('Giving direction to speaker');

      const progress = this.calculateProgress();
      const history = this.getConversationHistory();

      const messages = [
        {
          role: 'user' as const,
          content: `You are directing a podcast. Here's the current situation:

Podcast Plan: ${this.podcastPlan}

Progress: ${progress}% complete
Conversation so far:
${history}

Current speaker: ${(speakerAgent as any).speaker?.name || 'Unknown'}

Give clear, specific direction to the current speaker about what they should say next. Be conversational and natural in your direction.`
        }
      ];

      const direction = await this.callClaude(messages, 300);
      logger.debug(`Direction given: ${direction}`);
      
      return direction;
    } catch (error) {
      logger.error('Failed to give direction:', error);
      throw error;
    }
  }

  private calculateProgress(): number {
    const totalExpectedTurns = this.script.speeches.length;
    const currentTurns = this.script.speeches.length;
    return Math.min(100, Math.round((currentTurns / totalExpectedTurns) * 100));
  }

  private getConversationHistory(): string {
    return this.script.speeches
      .slice(-5) // Last 5 speeches
      .map(speech => `${speech.speaker.name}: ${speech.message}`)
      .join('\n');
  }
}
