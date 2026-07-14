import { z } from "zod";
import {
  AudienceProfile,
  EpistemicRole,
  SourceAccess,
  SpeakerAllocation,
  SourceType,
  UncertaintyStyle,
  VocalProviderName,
} from "../types";

// Environment validation schema
export const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1, "OpenAI API key is required"),
  ANTHROPIC_API_KEY: z.string().min(1, "Anthropic API key is required"),
  ELEVENLABS_API_KEY: z.string().optional(),
  DATA_DIR: z.string().optional(),
  AUDIO_DIR: z.string().optional(),
  SCRIPTS_DIR: z.string().optional(),
  EMBEDDINGS_DIR: z.string().optional(),
  DEFAULT_VOICE_PROVIDER: z.nativeEnum(VocalProviderName).optional(),
  DEFAULT_CHUNK_SIZE: z.string().optional(),
  DEFAULT_CHUNK_OVERLAP: z.string().optional(),
});

// Voice validation schema
export const voiceSchema = z.object({
  name: z.string().min(1, "Voice name is required"),
  description: z.string().optional(),
  provider: z.nativeEnum(VocalProviderName),
  providerId: z.string().min(1, "Provider ID is required"),
  settings: z.record(z.any()).optional(),
});

// Speaker validation schema
export const speakerSchema = z.object({
  name: z.string().min(1, "Speaker name is required"),
  personality: z.string().min(1, "Speaker personality is required"),
  voiceId: z.string().min(1, "Voice ID is required"),
  voiceStyle: z.string().optional(),
  isExpert: z.boolean().optional(),
  roleProfile: z
    .object({
      epistemicRole: z.nativeEnum(EpistemicRole),
      sourceAccess: z.nativeEnum(SourceAccess),
      uncertaintyStyle: z.nativeEnum(UncertaintyStyle),
    })
    .optional(),
});

// Material validation schema
export const materialSchema = z.object({
  title: z.string().min(1, "Material title is required"),
  content: z.string().min(1, "Material content is required"),
  source: z.string().min(1, "Material source is required"),
  sourceType: z.nativeEnum(SourceType),
  metadata: z.record(z.any()).optional(),
});

// Script generation validation schema
export const scriptGenerationSchema = z.object({
  title: z.string().min(1, "Script title is required"),
  description: z.string().optional(),
  speakers: z
    .array(z.object({ id: z.string() }))
    .min(1, "At least one speaker is required"),
  materials: z.array(z.object({ id: z.string() })).optional(),
  maxTurns: z.number().min(1).max(500),
  maxDuration: z.number().min(60).max(3600),
  allocation: z.nativeEnum(SpeakerAllocation).optional(),
  audienceProfile: z.nativeEnum(AudienceProfile).optional(),
});

export function validateEnvironment(): void {
  try {
    envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingFields = error.errors.map((err) => err.path.join("."));
      throw new Error(
        `Missing or invalid environment variables: ${missingFields.join(", ")}`
      );
    }
    throw error;
  }
}

export function validateVoice(data: unknown) {
  return voiceSchema.parse(data);
}

export function validateSpeaker(data: unknown) {
  return speakerSchema.parse(data);
}

export function validateMaterial(data: unknown) {
  return materialSchema.parse(data);
}

export function validateScriptGeneration(data: unknown) {
  return scriptGenerationSchema.parse(data);
}
