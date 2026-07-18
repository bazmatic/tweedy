import axios, { AxiosError } from "axios";
import * as fs from "fs-extra";
import * as path from "path";
import { GoogleAuth } from "google-auth-library";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { AiModelFactory } from "./AiModelFactory";
import { ModelTask } from "./ModelRoutingPolicy";
import {
  IMultispeakerVocalProvider,
  MultispeakerTurn,
  TtsResult,
  Voice,
  VocalProviderName,
} from "../types";
import { appConfig } from "../utils/config";
import { logger } from "../utils/logger";
import { stripMarkdownEmphasis } from "./text-sanitization";

const DEFAULT_LANGUAGE_CODE = "en-US";
const AUTH_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const MODEL_NAME = "gemini-3.1-flash-tts-preview";
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

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

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

  /** Inserts Gemini-native bracketed delivery-direction tags (e.g. [pause],
   * [very slowly], [sarcastically, one word at a time]) into text via an
   * LLM call. Unlike Chirp3-HD's fixed tag vocabulary, Gemini's bracket
   * syntax is free-form per Google's documentation, so validation can't
   * whitelist specific tags — instead it strips any [...] span and checks
   * the remaining wording is unchanged from the input. Always resolves;
   * falls back to the original text on any validation failure or error. */
  private async addDeliveryTags(text: string): Promise<string> {
    try {
      const model = AiModelFactory.getModel(
        appConfig.defaultAiProvider,
        ModelTask.SpeechEffectTagging,
        500
      );
      const response = await model.invoke([
        new SystemMessage(
          "You add delivery-direction tags to text for Google's Gemini TTS. " +
            "Gemini supports free-form bracketed director's notes anywhere in the text, e.g. [pause], " +
            "[very slowly], [sarcastically, one word at a time] — write whatever natural-language direction " +
            "fits, there is no fixed tag list. " +
            "Use them sparingly: most lines should come back completely unchanged, with zero tags added — " +
            "only add one where it clearly improves delivery (a natural hesitation, a beat before a punchline, " +
            "a marked tonal shift). Never add more than one tag to a short line. " +
            "Do not change, add, or remove a single word, letter, or punctuation mark of the original text — " +
            "the only thing you may add is bracketed tags. " +
            "Respond with only the tagged text, nothing else — no commentary, no markdown fences."
        ),
        new HumanMessage(text),
      ]);

      const tagged = typeof response.content === "string" ? response.content.trim() : "";
      if (!tagged) return text;

      const strippedOfBrackets = tagged.replace(/\[[^\]]*\]/g, "");
      if (normalizeWhitespace(strippedOfBrackets) !== normalizeWhitespace(text)) {
        logger.warn(
          "Gemini delivery-tagged text failed validation (altered wording), using plain text"
        );
        return text;
      }

      return tagged;
    } catch (error) {
      logger.warn("Failed to add Gemini delivery tags, using plain text:", error);
      return text;
    }
  }

  private buildAliasedText(turns: MultispeakerTurn[]): string {
    const aliasBySpeakerId = this.buildSpeakerAliases(turns);
    return turns
      .map((turn) => `${aliasBySpeakerId.get(turn.speaker.id)}: ${stripMarkdownEmphasis(turn.text)}`)
      .join("\n");
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

      const taggedTurns = await Promise.all(
        turns.map(async (turn) => ({
          ...turn,
          text: await this.addDeliveryTags(stripMarkdownEmphasis(turn.text)),
        }))
      );

      const text =
        distinctSpeakerIds.size === 1
          ? taggedTurns.map((turn) => turn.text).join("\n")
          : this.buildAliasedText(taggedTurns);

      // input.prompt applies to the whole call, not per speaker, so this is
      // a blunt instrument in a mixed-speaker chunk — every speaker in that
      // call gets the same direction. Deliberately simple (first non-empty
      // voiceStyle found, no per-speaker attribution or per-line overrides)
      // rather than the earlier per-speaker prompt-building this replaced.
      const prompt = turns.find((turn) => turn.voiceStyle?.trim())?.voiceStyle?.trim();

      const authHeaders = await this.authHeaders();
      const response = await axios.post(
        `${this.baseUrl}/text:synthesize`,
        {
          input: { text, ...(prompt ? { prompt } : {}) },
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
