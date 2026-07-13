import { config } from "dotenv";
import * as os from "os";
import * as path from "path";
import { AiProviderName, AppConfig, VocalProviderName } from "../types";

// Load environment variables: cwd .env takes precedence, falling back to a
// global ~/.tweedy/.env so the CLI works the same regardless of cwd.
config();
config({ path: path.join(os.homedir(), ".tweedy", ".env") });

export function loadConfig(): AppConfig {
  return {
    dataDir: process.env.DATA_DIR || "./data",
    audioDir: process.env.AUDIO_DIR || "./audio",
    scriptsDir: process.env.SCRIPTS_DIR || "./scripts",
    embeddingsDir: process.env.EMBEDDINGS_DIR || "./embeddings",
    defaultVoiceProvider:
      (process.env.DEFAULT_VOICE_PROVIDER as VocalProviderName) ||
      VocalProviderName.ElevenLabs,
    defaultAiProvider:
      (process.env.DEFAULT_AI_PROVIDER as AiProviderName) ||
      AiProviderName.Anthropic,
    defaultChunkSize: parseInt(process.env.DEFAULT_CHUNK_SIZE || "1000"),
    defaultChunkOverlap: parseInt(process.env.DEFAULT_CHUNK_OVERLAP || "200"),
  };
}

export function validateConfig(config: AppConfig): {
  valid: boolean;
  missingVars: string[];
} {
  const requiredEnvVars = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"];

  const missingVars = requiredEnvVars.filter(
    (varName) => !process.env[varName]
  );

  return {
    valid: missingVars.length === 0,
    missingVars,
  };
}

export const appConfig = loadConfig();
