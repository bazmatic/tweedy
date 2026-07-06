import { EmbeddingService } from '../types';

const EMOTION_MATCH_THRESHOLD = 0.75;

// Full list of Cartesia's supported emotion words, verbatim from
// https://docs.cartesia.ai/build-with-cartesia/capability-guides/volume-speed-emotion
const CARTESIA_EMOTIONS = [
  'neutral', 'happy', 'excited', 'enthusiastic', 'elated', 'euphoric',
  'triumphant', 'amazed', 'surprised', 'flirtatious', 'curious', 'content',
  'peaceful', 'serene', 'calm', 'grateful', 'affectionate', 'trust',
  'sympathetic', 'anticipation', 'mysterious', 'angry', 'mad', 'outraged',
  'frustrated', 'agitated', 'threatened', 'disgusted', 'contempt', 'envious',
  'sarcastic', 'ironic', 'sad', 'dejected', 'melancholic', 'disappointed',
  'hurt', 'guilty', 'bored', 'tired', 'rejected', 'nostalgic', 'wistful',
  'apologetic', 'hesitant', 'insecure', 'confused', 'resigned', 'anxious',
  'panicked', 'alarmed', 'scared', 'proud', 'confident', 'distant',
  'skeptical', 'contemplative', 'determined',
];

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class CartesiaEmotionMatcher {
  private emotionEmbeddings?: number[][];

  constructor(private readonly embeddingService: EmbeddingService) {}

  private async getEmotionEmbeddings(): Promise<number[][]> {
    if (!this.emotionEmbeddings) {
      this.emotionEmbeddings = await this.embeddingService.embedDocuments(CARTESIA_EMOTIONS);
    }
    return this.emotionEmbeddings;
  }

  async match(style: string | undefined): Promise<string | undefined> {
    if (!style || style.trim().length === 0) {
      return undefined;
    }

    const [styleEmbedding, emotionEmbeddings] = await Promise.all([
      this.embeddingService.embedText(style),
      this.getEmotionEmbeddings(),
    ]);

    let bestIndex = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < emotionEmbeddings.length; i++) {
      const score = cosineSimilarity(styleEmbedding, emotionEmbeddings[i]);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    if (bestIndex === -1 || bestScore < EMOTION_MATCH_THRESHOLD) {
      return undefined;
    }

    return CARTESIA_EMOTIONS[bestIndex];
  }
}
