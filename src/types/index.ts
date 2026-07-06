import { SpeakerAgentToolName } from "../agents/speaker-tools";

// Core Enums
export enum SourceType {
  Claude = "claude",
  Document = "document",
  Web = "web",
  Manual = "manual",
}

export enum SpeakerAllocation {
  Random = "random",
  Sequential = "sequential",
  Managed = "managed",
}

export enum VocalProviderName {
  ElevenLabs = "elevenlabs",
  OpenAI = "openai",
  Hume = "hume",
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
  instructions?: string;
}

export interface Speaker {
  id: string;
  name: string;
  personality: string;
  voice: Voice;
  voiceStyle: string;
  isExpert: boolean;
}

export interface Speech {
  id: string;
  speaker: Speaker;
  message: string;
  instructions: string;
  voice: Voice;
  voiceStyle: string;
  timestamp: Date;
  tool?: SpeakerAgentToolName;
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

export interface PodcastScript {
  id: string;
  title: string;
  description: string;
  speakers: Speaker[];
  speeches: Speech[];
  materials: PodcastMaterial[];
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
  defaultEmbeddingModel: string;
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
    speaker: Omit<SpeakerRecord, "id" | "createdAt" | "updatedAt">
  ): Promise<SpeakerRecord>;
  getById(id: string): Promise<SpeakerRecord | null>;
  getAll(): Promise<SpeakerRecord[]>;
  update(
    id: string,
    speaker: Partial<Omit<SpeakerRecord, "id" | "createdAt" | "updatedAt">>
  ): Promise<SpeakerRecord | null>;
  delete(id: string): Promise<boolean>;
  findByName(name: string): Promise<SpeakerRecord | null>;
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
  findBySource(source: string): Promise<MaterialRecord[]>;
}

export interface ISpeechRepository {
  create(speech: Omit<SpeechRecord, "id">): Promise<SpeechRecord>;
  getById(id: string): Promise<SpeechRecord | null>;
  getAll(): Promise<SpeechRecord[]>;
  delete(id: string): Promise<boolean>;
}

// Provider Interfaces
export interface IVocalProvider {
  tts(params: VocalProviderTtsParams): Promise<string>;
  getVoices(): Promise<Voice[]>;
}

export interface VocalProviderTtsParams {
  speech: Speech;
  voice: Voice;
  outputFileName: string;
}

export interface IDocumentProcessor {
  process(filePath: string): Promise<ProcessedDocument>;
}

export interface ProcessedDocument {
  title: string;
  content: string;
  metadata: Record<string, any>;
}

// Agent Interfaces
export interface ISpeakerAgent {
  speak(script: PodcastScript, direction: string): Promise<Speech>;
}

export interface IDirectorAgent {
  createPodcastPlan(script: PodcastScript): Promise<string>;
  giveDirection(speakerAgent: ISpeakerAgent): Promise<string>;
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
    speaker: Omit<SpeakerRecord, "id" | "createdAt" | "updatedAt">
  ): Promise<Speaker>;
  getSpeaker(id: string): Promise<Speaker>;
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
}

export interface IMaterialService {
  addMaterial(
    material: Omit<MaterialRecord, "id" | "createdAt">
  ): Promise<PodcastMaterial>;
  getMaterial(id: string): Promise<PodcastMaterial>;
  getAllMaterials(): Promise<PodcastMaterial[]>;
  deleteMaterial(id: string): Promise<void>;
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
