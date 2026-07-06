import { VocalProviderFactory, AudioProcessor } from "../providers";
import { VocalProviderName, Speech, Voice } from "../types";
import { appConfig } from "../utils/config";
import { logger } from "../utils/logger";
import * as path from "path";

export interface IAudioService {
  generateAudio(speeches: Speech[], outputPath: string): Promise<string>;
  processAudioFile(inputPath: string, outputPath: string): Promise<void>;
}

export class AudioService implements IAudioService {
  async generateAudio(speeches: Speech[], outputPath: string): Promise<string> {
    try {
      logger.info(`Generating audio for ${speeches.length} speeches`);

      const audioFiles: string[] = [];
      const batchSize = 3;

      // Process speeches in batches
      for (let i = 0; i < speeches.length; i += batchSize) {
        const batch = speeches.slice(i, i + batchSize);
        const batchPromises = batch.map((speech) =>
          this.generateSpeechAudio(speech)
        );
        const batchResults = await Promise.all(batchPromises);
        audioFiles.push(...batchResults);
      }

      // Concatenate all audio files
      await AudioProcessor.concatenateAudio(audioFiles, outputPath);

      logger.success(`Audio generated: ${outputPath}`);
      return outputPath;
    } catch (error) {
      logger.error("Failed to generate audio:", error);
      throw error;
    }
  }

  async processAudioFile(inputPath: string, outputPath: string): Promise<void> {
    try {
      await AudioProcessor.processAudio(inputPath, outputPath);
      logger.info(`Audio processed: ${outputPath}`);
    } catch (error) {
      logger.error("Failed to process audio file:", error);
      throw error;
    }
  }

  private async generateSpeechAudio(speech: Speech): Promise<string> {
    const provider = VocalProviderFactory.getProvider(speech.voice.provider);
    const outputFileName = path.join("speeches", `${speech.id}.mp3`);

    await provider.tts({
      speech,
      voice: speech.voice,
      outputFileName,
    });

    const outputPath = path.join(appConfig.audioDir, outputFileName);
    return outputPath;
  }
}
