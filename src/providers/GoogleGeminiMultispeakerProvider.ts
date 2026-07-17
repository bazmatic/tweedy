import axios, { AxiosError } from "axios";
import * as fs from "fs-extra";
import * as path from "path";
import { GoogleAuth } from "google-auth-library";
import {
  IMultispeakerVocalProvider,
  MultispeakerTurn,
  TtsResult,
  Voice,
  VocalProviderName,
} from "../types";
import { appConfig } from "../utils/config";
import { logger } from "../utils/logger";

const DEFAULT_LANGUAGE_CODE = "en-US";
const AUTH_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const MODEL_NAME = "gemini-2.5-flash-tts";
const DEFAULT_MAX_TURNS_PER_CHUNK = 8;

// Known Gemini TTS voice names (30-voice catalogue documented for the
// multi-speaker-capable Gemini TTS models). Not discoverable via the
// text-to-speech /v1/voices listing endpoint the way Chirp3-HD voices are.
const GEMINI_TTS_VOICE_NAMES = [
  "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede",
  "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba",
  "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
  "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi",
  "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
];

export class GoogleGeminiMultispeakerProvider implements IMultispeakerVocalProvider {
  private auth: GoogleAuth;
  private baseUrl = "https://texttospeech.googleapis.com/v1";
  readonly maxTurnsPerChunk: number;

  constructor() {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      throw new Error("GOOGLE_APPLICATION_CREDENTIALS environment variable is required");
    }
    this.auth = new GoogleAuth({ scopes: [AUTH_SCOPE] });
    this.maxTurnsPerChunk = appConfig.multispeakerChunkSize ?? DEFAULT_MAX_TURNS_PER_CHUNK;
  }

  private redactAuthHeader(error: unknown): unknown {
    if (!axios.isAxiosError(error)) return error;
    const redacted = error as AxiosError;
    if (redacted.config?.headers?.Authorization) {
      redacted.config.headers.Authorization = "[REDACTED]";
    }
    return redacted;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const client = await this.auth.getClient();
    const { token } = await client.getAccessToken();
    if (!token) {
      throw new Error("Failed to obtain a Google Cloud access token");
    }
    return { Authorization: `Bearer ${token}` };
  }

  /** Assigns each distinct speaker in the chunk a stable alphanumeric alias
   * (SpeakerN), in order of first appearance — the API requires aliases to
   * be alphanumeric with no whitespace, which speaker IDs aren't guaranteed
   * to be. */
  private buildSpeakerAliases(turns: MultispeakerTurn[]): Map<string, string> {
    const aliasBySpeakerId = new Map<string, string>();
    let index = 1;
    for (const turn of turns) {
      if (!aliasBySpeakerId.has(turn.speaker.id)) {
        aliasBySpeakerId.set(turn.speaker.id, `Speaker${index}`);
        index++;
      }
    }
    return aliasBySpeakerId;
  }

  async synthesizeChunk(turns: MultispeakerTurn[], outputFileName: string): Promise<TtsResult> {
    if (turns.length === 0) {
      throw new Error("synthesizeChunk requires at least one turn");
    }

    try {
      const outputPath = path.join(appConfig.audioDir, outputFileName);
      await fs.ensureDir(path.dirname(outputPath));

      const aliasBySpeakerId = this.buildSpeakerAliases(turns);
      const text = turns
        .map((turn) => `${aliasBySpeakerId.get(turn.speaker.id)}: ${turn.text}`)
        .join("\n");

      const speakerVoiceConfigs = [...aliasBySpeakerId.entries()].map(([speakerId, alias]) => {
        const turn = turns.find((t) => t.speaker.id === speakerId)!;
        return { speakerAlias: alias, speakerId: turn.voice.providerId };
      });

      const authHeaders = await this.authHeaders();
      const response = await axios.post(
        `${this.baseUrl}/text:synthesize`,
        {
          input: { text },
          voice: {
            languageCode: DEFAULT_LANGUAGE_CODE,
            modelName: MODEL_NAME,
            multiSpeakerVoiceConfig: { speakerVoiceConfigs },
          },
          audioConfig: { audioEncoding: "MP3" },
        },
        { headers: { ...authHeaders, "Content-Type": "application/json" } }
      );

      const audioBuffer = Buffer.from(response.data.audioContent, "base64");
      await fs.writeFile(outputPath, audioBuffer);
      logger.info(`Multispeaker TTS completed: ${outputPath}`);

      return { outputPath };
    } catch (error) {
      logger.error("Multispeaker TTS failed:", this.redactAuthHeader(error));
      throw error;
    }
  }

  async getVoices(): Promise<Voice[]> {
    return GEMINI_TTS_VOICE_NAMES.map((name) => ({
      id: name,
      name,
      description: `Google Gemini TTS multispeaker voice: ${name}`,
      provider: VocalProviderName.GoogleGeminiMultispeaker,
      providerId: name,
      settings: {},
    }));
  }
}
