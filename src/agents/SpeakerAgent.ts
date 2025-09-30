import { ISpeakerAgent, PodcastScript, Speech, Speaker } from '../types';
import { BaseAgent } from './BaseAgent';
import { logger } from '../utils/logger';

export enum SpeakerAgentTool {
  SPEAK = 'speak',
  INTERJECT = 'interject',
  ONE_LINER = 'one_liner',
  QUESTION = 'question',
  COMMENT = 'comment',
}

export class SpeakerAgent extends BaseAgent implements ISpeakerAgent {
  private speaker: Speaker;
  private maxAttempts = 3;

  constructor(speaker: Speaker) {
    super();
    this.speaker = speaker;
  }

  async speak(script: PodcastScript, direction: string): Promise<Speech> {
    let attempts = 0;
    
    while (attempts < this.maxAttempts) {
      try {
        this.logAgentAction('Generating speech', { speaker: this.speaker.name, attempt: attempts + 1 });

        const speechText = await this.generateSpeech(script, direction);
        
        const speech: Speech = {
          id: this.generateId(),
          speaker: this.speaker,
          message: speechText,
          instructions: direction,
          voice: this.speaker.voice,
          voiceStyle: this.speaker.voiceStyle,
          timestamp: new Date(),
        };

        logger.info(`Speech generated for ${this.speaker.name}: ${speechText.substring(0, 100)}...`);
        return speech;
      } catch (error) {
        attempts++;
        logger.warn(`Speech generation attempt ${attempts} failed:`, error);
        
        if (attempts >= this.maxAttempts) {
          return this.createFallbackSpeech();
        }
      }
    }

    return this.createFallbackSpeech();
  }

  private async generateSpeech(script: PodcastScript, direction: string): Promise<string> {
    const conversationHistory = this.getConversationHistory(script);
    const relevantMaterials = this.getRelevantMaterials(script);

    const messages = [
      {
        role: 'user' as const,
        content: `You are ${this.speaker.name}, a podcast speaker with the following characteristics:
- Personality: ${this.speaker.personality}
- Voice Style: ${this.speaker.voiceStyle}
- Expert Level: ${this.speaker.isExpert ? 'Expert' : 'General audience'}

Podcast Context:
- Title: ${script.title}
- Description: ${script.description}

Conversation History:
${conversationHistory}

Relevant Materials:
${relevantMaterials}

Director's Direction: ${direction}

Respond naturally as ${this.speaker.name}. Keep your response conversational, engaging, and appropriate for a podcast. Be authentic to your personality and expertise level.`
      }
    ];

    return await this.callClaude(messages, 500);
  }

  private getConversationHistory(script: PodcastScript): string {
    return script.speeches
      .slice(-10) // Last 10 speeches
      .map(speech => `${speech.speaker.name}: ${speech.message}`)
      .join('\n');
  }

  private getRelevantMaterials(script: PodcastScript): string {
    return script.materials
      .slice(0, 3) // First 3 materials
      .map(material => `${material.title}: ${material.content.substring(0, 200)}...`)
      .join('\n\n');
  }

  private createFallbackSpeech(): Speech {
    const fallbackMessages = [
      "That's an interesting point. Could you tell me more about that?",
      "I see what you mean. What do you think about the implications?",
      "That's a great question. Let me think about that for a moment.",
      "I'm not sure I fully understand. Could you elaborate?",
      "That reminds me of something similar I heard about.",
    ];

    const randomMessage = fallbackMessages[Math.floor(Math.random() * fallbackMessages.length)];

    return {
      id: this.generateId(),
      speaker: this.speaker,
      message: randomMessage,
      instructions: 'Fallback response due to generation failure',
      voice: this.speaker.voice,
      voiceStyle: this.speaker.voiceStyle,
      timestamp: new Date(),
    };
  }

  private generateId(): string {
    return Math.random().toString(36).substr(2, 9);
  }
}
