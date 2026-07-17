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
// Google documents a hard 4000-byte limit on the `input.text` field for this
// endpoint (confirmed live: a 4405-byte chunk was rejected with
// "Either `input.text` or `input.prompt` is longer than the limit of 4000
// bytes."). Budget below that ceiling to leave headroom for encoding
// variance across turns.
const MAX_BYTES_PER_CHUNK = 3600;

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
  readonly maxBytesPerChunk: number = MAX_BYTES_PER_CHUNK;

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
    if ((redacted.request as { _header?: string } | undefined)?._header) {
      (redacted.request as { _header?: string })._header = (
        redacted.request as { _header: string }
      )._header.replace(/Authorization: Bearer [^\r\n]+/i, "Authorization: [REDACTED]");
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

  private buildAliasedText(turns: MultispeakerTurn[]): string {
    const aliasBySpeakerId = this.buildSpeakerAliases(turns);
    return turns.map((turn) => `${aliasBySpeakerId.get(turn.speaker.id)}: ${turn.text}`).join("\n");
  }

  private buildSpeakerVoiceConfigs(
    turns: MultispeakerTurn[]
  ): { speakerAlias: string; speakerId: string }[] {
    const aliasBySpeakerId = this.buildSpeakerAliases(turns);
    return [...aliasBySpeakerId.entries()].map(([speakerId, alias]) => {
      const turn = turns.find((t) => t.speaker.id === speakerId)!;
      return { speakerAlias: alias, speakerId: turn.voice.providerId };
    });
  }

  async synthesizeChunk(turns: MultispeakerTurn[], outputFileName: string): Promise<TtsResult> {
    if (turns.length === 0) {
      throw new Error("synthesizeChunk requires at least one turn");
    }

    try {
      const outputPath = path.join(appConfig.audioDir, outputFileName);
      await fs.ensureDir(path.dirname(outputPath));

      // Gemini TTS voices are locale-agnostic by name (unlike Chirp3-HD's
      // per-locale voice IDs) — the same voice name takes on an accent via
      // languageCode. One call carries one languageCode for every speaker
      // in it, so this reads it off the first turn's voice; multispeaker
      // eligibility already requires every speaker in a script to share
      // one provider, and in practice a script's speakers share one locale.
      const languageCode =
        (turns[0].voice.settings.providerOptions?.languageCode as string) ?? DEFAULT_LANGUAGE_CODE;

      const distinctSpeakerIds = new Set(turns.map((turn) => turn.speaker.id));

      // Google's multi-speaker synthesis rejects any call with only one
      // speaker ("Multi-speaker synthesis requires two distinct
      // speakers."). A run of consecutive same-speaker turns (e.g. a long
      // solo monologue) can land in a chunk on its own — route those
      // through plain single-voice synthesis on the same voice instead of
      // forcing a (rejected) multi-speaker call.
      const voiceConfig =
        distinctSpeakerIds.size === 1
          ? { languageCode, modelName: MODEL_NAME, name: turns[0].voice.providerId }
          : {
              languageCode,
              modelName: MODEL_NAME,
              multiSpeakerVoiceConfig: { speakerVoiceConfigs: this.buildSpeakerVoiceConfigs(turns) },
            };

      const text =
        distinctSpeakerIds.size === 1
          ? turns.map((turn) => turn.text).join("\n")
          : this.buildAliasedText(turns);

      const authHeaders = await this.authHeaders();
      const response = await axios.post(
        `${this.baseUrl}/text:synthesize`,
        {
          input: { text },
          voice: voiceConfig,
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
