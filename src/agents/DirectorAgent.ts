import { IDirectorAgent, PodcastScript, Speaker } from '../types';
import { BaseAgent } from './BaseAgent';
import { logger } from '../utils/logger';
import {
  SelectNextSpeakerInput,
  toSelectNextSpeakerTool,
} from './director-tools';

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

      this.podcastPlan = await this.callModel(messages, 800);
      logger.info('Podcast plan created successfully');
      
      return this.podcastPlan;
    } catch (error) {
      logger.error('Failed to create podcast plan:', error);
      throw error;
    }
  }

  async chooseNextSpeaker(
    script: PodcastScript
  ): Promise<{ speaker: Speaker; direction: string }> {
    try {
      this.logAgentAction('Choosing next speaker');

      const progress = this.calculateProgress(script);
      const history = this.getConversationHistory(script);
      const speakerDescriptions = script.speakers
        .map(
          (speaker) =>
            `- ${speaker.name} (id: ${speaker.id}, ${
              speaker.isExpert ? 'expert' : 'interviewer'
            }): ${speaker.personality}`
        )
        .join('\n');

      const messages = [
        {
          role: 'user' as const,
          content: `You are directing a podcast. Here's the current situation:

Podcast Plan: ${this.podcastPlan}

Progress: ${progress}% complete

Speakers:
${speakerDescriptions}

Conversation so far:
${history || '(nothing said yet — this is the opening of the episode)'}

Decide which speaker should talk next and give them clear, specific, conversational direction about what they should say. On the opening of the episode, this should usually be the interviewer.${this.getPacingNote(
            script
          )}`
        }
      ];

      const tools = [toSelectNextSpeakerTool(script.speakers)];
      const { speakerId, direction } =
        await this.callModelForToolInput<SelectNextSpeakerInput>(
          messages,
          tools,
          300
        );

      const speaker = script.speakers.find((s) => s.id === speakerId);
      if (!speaker) {
        logger.warn(
          `Director chose unknown speakerId "${speakerId}"; falling back to alternating speaker`
        );
        return {
          speaker: this.fallbackSpeaker(script),
          direction,
        };
      }

      logger.debug(`Director chose ${speaker.name}: ${direction}`);
      return { speaker, direction };
    } catch (error) {
      logger.error('Failed to choose next speaker:', error);
      throw error;
    }
  }

  private fallbackSpeaker(script: PodcastScript): Speaker {
    const lastSpeaker = script.speeches[script.speeches.length - 1]?.speaker;
    const eligible = script.speakers.filter((s) => s.id !== lastSpeaker?.id);
    if (eligible.length === 0) {
      return script.speakers[0];
    }
    return eligible[Math.floor(Math.random() * eligible.length)];
  }

  private calculateProgress(script: PodcastScript): number {
    const totalExpectedTurns = script.speeches.length;
    const currentTurns = script.speeches.length;
    return Math.min(100, Math.round((currentTurns / totalExpectedTurns) * 100));
  }

  /**
   * If recent turns have run long, tell the director to call for a short,
   * reactive turn instead of another explanation — keeps the back-and-forth alive.
   */
  private getPacingNote(script: PodcastScript): string {
    const recentSpeeches = script.speeches.slice(-3);
    if (recentSpeeches.length === 0) {
      return '';
    }

    const averageLength =
      recentSpeeches.reduce((sum, speech) => sum + speech.message.length, 0) /
      recentSpeeches.length;

    if (averageLength > 150) {
      return ' The last few turns have been long explanations — direct this speaker to give a short, punchy reaction or a quick pointed question instead of another lengthy point.';
    }

    return '';
  }

  private getConversationHistory(script: PodcastScript): string {
    return script.speeches
      .slice(-5) // Last 5 speeches
      .map(speech => `${speech.speaker.name}: ${speech.message}`)
      .join('\n');
  }
}

