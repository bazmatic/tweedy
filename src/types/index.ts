import { SpeakerAgentToolName } from "../agents/speaker-tools";

// Core Enums
export enum SourceType {
  Claude = "claude",
  Document = "document",
  Web = "web",
  Manual = "manual",
  Research = "research",
}

export enum SpeakerAllocation {
  Random = "random",
  Sequential = "sequential",
  Managed = "managed",
}

export enum VocalProviderName {
  ElevenLabs = "elevenlabs",
  ElevenLabsV3 = "elevenlabs_v3",
  OpenAI = "openai",
  Hume = "hume",
  Cartesia = "cartesia",
  Kokoro = "kokoro",
  Grok = "grok",
}

export enum AiProviderName {
  Anthropic = "anthropic",
  DeepSeek = "deepseek",
}

export enum ResearchProviderName {
  Perplexity = "perplexity",
}

export enum DocumentType {
  PDF = "pdf",
  TXT = "txt",
  MD = "md",
  HTML = "html",
}

export enum ProcessingStatus {
  Pending = "pending",
  Processing = "processing",
  Completed = "completed",
  Error = "error",
}

// Core Domain Types
export interface Voice {
  id: string;
  name: string;
  description: string;
  provider: VocalProviderName;
  providerId: string;
  settings: VoiceSettings;
}

export interface VoiceSettings {
  stability?: number;
  similarityBoost?: number;
  style?: string;
  speed?: number;
  instructions?: string;
  /** Provider-specific TTS options that don't have a shared equivalent
   * (e.g. Cartesia's `emotion`/`volume`, either provider's `speed`). */
  providerOptions?: Record<string, unknown>;
}

export interface Speaker {
  id: string;
  slug: string;
  name: string;
  personality: string;
  voice: Voice;
  voiceStyle: string;
  isExpert: boolean;
}

export type StopReason = "max_tokens" | "stop" | "tool_use" | "unknown";

export interface Speech {
  id: string;
  speaker: Speaker;
  message: string;
  instructions: string;
  voice: Voice;
  voiceStyle: string;
  timestamp: Date;
  tool?: SpeakerAgentToolName;
  stopReason?: StopReason;
}

export interface PodcastMaterial {
  id: string;
  title: string;
  content: string;
  source: string;
  sourceType: SourceType;
  metadata: Record<string, any>;
  createdAt: Date;
}

export interface DiscussionPoint {
  id: string;
  text: string;
  covered: boolean;
  coveredAtTurn?: number;
}

export interface PodcastScript {
  id: string;
  title: string;
  description: string;
  speakers: Speaker[];
  speeches: Speech[];
  materials: PodcastMaterial[];
  discussionPoints: DiscussionPoint[];
  createdAt: Date;
  updatedAt: Date;
}

// Configuration Types
export interface AppConfig {
  dataDir: string;
  audioDir: string;
  scriptsDir: string;
  embeddingsDir: string;
  defaultVoiceProvider: VocalProviderName;
  defaultAiProvider: AiProviderName;
  defaultChunkSize: number;
  defaultChunkOverlap: number;
}

export interface GenerateScriptParams {
  title: string;
  description: string;
  speakers: Speaker[];
  materials: PodcastMaterial[];
  maxTurns: number;
  maxDuration: number; // in seconds
  allocation: SpeakerAllocation;
}

// Repository Types
export interface VoiceRecord {
  id: string;
  name: string;
  description: string;
  provider: VocalProviderName;
  providerId: string;
  settings: VoiceSettings;
  createdAt: Date;
  updatedAt: Date;
}

export interface SpeakerRecord {
  id: string;
  slug: string;
  name: string;
  personality: string;
  voiceId: string;
  voiceStyle: string;
  isExpert: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScriptRecord {
  id: string;
  title: string;
  description: string;
  speakerIds: string[];
  speechIds: string[];
  materialIds: string[];
  discussionPoints: DiscussionPoint[];
  createdAt: Date;
  updatedAt: Date;
}

export interface MaterialRecord {
  id: string;
  title: string;
  content: string;
  source: string;
  sourceType: SourceType;
  metadata: Record<string, any>;
  createdAt: Date;
}

export interface SpeechRecord {
  id: string;
  speakerId: string;
  message: string;
  instructions: string;
  voiceId: string;
  voiceStyle: string;
  timestamp: Date;
  tool?: SpeakerAgentToolName;
  stopReason?: StopReason;
}

// Service Interfaces
export interface IVoiceRepository {
  create(
    voice: Omit<VoiceRecord, "id" | "createdAt" | "updatedAt">
  ): Promise<VoiceRecord>;
  getById(id: string): Promise<VoiceRecord | null>;
  getAll(): Promise<VoiceRecord[]>;
  update(
    id: string,
    voice: Partial<Omit<VoiceRecord, "id" | "createdAt" | "updatedAt">>
  ): Promise<VoiceRecord | null>;
  delete(id: string): Promise<boolean>;
  findByName(name: string): Promise<VoiceRecord | null>;
}

export interface ISpeakerRepository {
  create(
    speaker: Omit<SpeakerRecord, "id" | "slug" | "createdAt" | "updatedAt">,
    provider: VocalProviderName
  ): Promise<SpeakerRecord>;
  getById(id: string): Promise<SpeakerRecord | null>;
  getAll(): Promise<SpeakerRecord[]>;
  update(
    id: string,
    speaker: Partial<Omit<SpeakerRecord, "id" | "createdAt" | "updatedAt">>
  ): Promise<SpeakerRecord | null>;
  delete(id: string): Promise<boolean>;
  findByName(name: string): Promise<SpeakerRecord | null>;
  findBySlug(slug: string): Promise<SpeakerRecord | null>;
}

export interface IScriptRepository {
  create(
    script: Omit<ScriptRecord, "id" | "createdAt" | "updatedAt">
  ): Promise<ScriptRecord>;
  getById(id: string): Promise<ScriptRecord | null>;
  getAll(): Promise<ScriptRecord[]>;
  update(
    id: string,
    script: Partial<Omit<ScriptRecord, "id" | "createdAt" | "updatedAt">>
  ): Promise<ScriptRecord | null>;
  delete(id: string): Promise<boolean>;
  findByName(name: string): Promise<ScriptRecord | null>;
}

export interface IMaterialRepository {
  create(
    material: Omit<MaterialRecord, "id" | "createdAt">
  ): Promise<MaterialRecord>;
  getById(id: string): Promise<MaterialRecord | null>;
  getAll(): Promise<MaterialRecord[]>;
  update(
    id: string,
    material: Partial<Omit<MaterialRecord, "id" | "createdAt">>
  ): Promise<MaterialRecord | null>;
  delete(id: string): Promise<boolean>;
  deleteAll(): Promise<number>;
  findBySource(source: string): Promise<MaterialRecord[]>;
}

export interface ISpeechRepository {
  create(speech: Omit<SpeechRecord, "id">): Promise<SpeechRecord>;
  getById(id: string): Promise<SpeechRecord | null>;
  getAll(): Promise<SpeechRecord[]>;
  delete(id: string): Promise<boolean>;
}

// Provider Interfaces
export interface LlmMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface LlmTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
}

export interface WordTimestamp {
  word: string;
  startSeconds: number;
  endSeconds: number;
}

export interface TtsResult {
  outputPath: string;
  wordTimestamps?: WordTimestamp[];
}

export interface IVocalProvider {
  tts(params: VocalProviderTtsParams): Promise<TtsResult>;
  getVoices(): Promise<Voice[]>;
}

export interface VocalProviderTtsParams {
  speech: Speech;
  voice: Voice;
  outputFileName: string;
  /** Text of the immediately preceding/following speech in the script, regardless of
   * speaker — passed to providers that support cross-clip prosody context (e.g.
   * ElevenLabs' previous_text/next_text) so delivery reacts naturally to context. */
  previousText?: string;
  nextText?: string;
}

export interface IDocumentProcessor {
  process(filePath: string): Promise<ProcessedDocument>;
}

export interface ProcessedDocument {
  title: string;
  content: string;
  metadata: Record<string, any>;
}

export interface ResearchMaterial {
  title: string;
  content: string;
  source: string;
  sourceType: SourceType;
  metadata: Record<string, any>;
}

export interface IResearchProvider {
  research(query: string): Promise<ResearchMaterial[]>;
}

// Agent Interfaces
export interface ISpeakerAgent {
  speak(
    speeches: Speech[],
    speakers: Speaker[],
    materials: PodcastMaterial[],
    title: string,
    description: string,
    direction: string,
    timeStatus?: string,
    forceNearlyOutOfTime?: boolean,
    requestSummary?: boolean,
    isFinalTurn?: boolean
  ): Promise<Speech>;
}

export interface IDirectorAgent {
  createPodcastPlan(script: PodcastScript): Promise<string>;
  chooseNextSpeaker(script: PodcastScript): Promise<{
    speaker: Speaker;
    direction: string;
    timeStatus: string;
    forceNearlyOutOfTime: boolean;
    requestSummary: boolean;
    isFinalTurn: boolean;
  }>;
  isConversationComplete(script: PodcastScript): Promise<boolean>;
}

// Service Interfaces
export interface IVoiceService {
  createVoice(
    voice: Omit<VoiceRecord, "id" | "createdAt" | "updatedAt">
  ): Promise<Voice>;
  getVoice(id: string): Promise<Voice>;
  getAllVoices(): Promise<Voice[]>;
  updateVoice(
    id: string,
    voice: Partial<Omit<VoiceRecord, "id" | "createdAt" | "updatedAt">>
  ): Promise<Voice>;
  deleteVoice(id: string): Promise<void>;
}

export interface ISpeakerService {
  createSpeaker(
    speaker: Omit<SpeakerRecord, "id" | "slug" | "createdAt" | "updatedAt">
  ): Promise<Speaker>;
  getSpeaker(id: string): Promise<Speaker>;
  getSpeakerBySlug(slug: string): Promise<Speaker>;
  getAllSpeakers(): Promise<Speaker[]>;
  updateSpeaker(
    id: string,
    speaker: Partial<Omit<SpeakerRecord, "id" | "createdAt" | "updatedAt">>
  ): Promise<Speaker>;
  deleteSpeaker(id: string): Promise<void>;
}

export interface IScriptService {
  generateScript(params: GenerateScriptParams): Promise<PodcastScript>;
  getScript(id: string): Promise<PodcastScript>;
  getAllScripts(): Promise<PodcastScript[]>;
  deleteScript(id: string): Promise<void>;
  exportScriptAsText(id: string): Promise<string>;
}

export interface IMaterialService {
  addMaterial(
    material: Omit<MaterialRecord, "id" | "createdAt">
  ): Promise<PodcastMaterial>;
  getMaterial(id: string): Promise<PodcastMaterial>;
  getAllMaterials(): Promise<PodcastMaterial[]>;
  deleteMaterial(id: string): Promise<void>;
  clearAllMaterials(): Promise<number>;
  searchMaterials(query: string): Promise<PodcastMaterial[]>;
}

// RAG System Types
export interface VectorStore {
  addDocuments(documents: Document[]): Promise<void>;
  similaritySearch(query: string, k?: number): Promise<Document[]>;
  deleteDocuments(ids: string[]): Promise<void>;
}

export interface Document {
  id: string;
  content: string;
  metadata: Record<string, any>;
}

export interface EmbeddingService {
  embedText(text: string): Promise<number[]>;
  embedDocuments(documents: string[]): Promise<number[][]>;
}
