import OpenAI from "openai";
import * as fs from "fs-extra";
import { IWhisperTranscriptionProvider, WordTimestamp } from "../types";
import { logger } from "../utils/logger";

export class OpenAIWhisperProvider implements IWhisperTranscriptionProvider {
  private client: OpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY environment variable is required");
    }
    this.client = new OpenAI({ apiKey });
  }

  async transcribe(audioFilePath: string): Promise<{ words: WordTimestamp[] }> {
    logger.debug(`Transcribing ${audioFilePath} with Whisper`);

    const response = await this.client.audio.transcriptions.create({
      file: fs.createReadStream(audioFilePath) as unknown as File,
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
    });

    const words = (response.words ?? []).map((w) => ({
      word: w.word,
      startSeconds: w.start,
      endSeconds: w.end,
    }));

    return { words };
  }
}
