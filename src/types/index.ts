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
  GoogleChirp = "google_chirp",
  GoogleGeminiMultispeaker = "google_gemini_multispeaker",
}

export enum AiProviderName {
  Anthropic = "anthropic",
  DeepSeek = "deepseek",
  OpenAI = "openai",
  Grok = "grok",
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
  roleProfile?: SpeakerRoleProfile;
  /** Example filler phrases/verbal tics this speaker reaches for (e.g. "Oh, wow"; "Huh, interesting"). */
  mannerisms?: string;
  /** Physical appearance description for consistent image generation downstream (e.g. video illustration). */
  physicalAppearance?: string;
}

export enum EpistemicRole {
  Expert = "expert",
  InformedHost = "informed_host",
  AudienceGuide = "audience_guide",
}

export enum SourceAccess {
  Full = "full",
  PreparedCards = "prepared_cards",
  HeardOnly = "heard_only",
}

export enum UncertaintyStyle {
  Precise = "precise",
  Exploratory = "exploratory",
  ListenerSurrogate = "listener_surrogate",
}

export interface SpeakerRoleProfile {
  epistemicRole: EpistemicRole;
  sourceAccess: SourceAccess;
  uncertaintyStyle: UncertaintyStyle;
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
  turnBrief?: TurnBrief;
  review?: TurnReview;
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

/** Subject-neutral editorial ingredients prepared from source material. */
export enum EditorialCardKind {
  EssentialPoint = "essential_point",
  Background = "background",
  Explanation = "explanation",
  Example = "example",
  Story = "story",
  Character = "character",
  Quote = "quote",
  VividDetail = "vivid_detail",
  Surprise = "surprise",
  HumourOpportunity = "humour_opportunity",
  Tension = "tension",
  DifferentPerspective = "different_perspective",
  Connection = "connection",
  Takeaway = "takeaway",
  OpenQuestion = "open_question",
  BigPicture = "big_picture",
}

export interface EvidenceRef {
  materialId: string;
  excerpt: string;
  section?: string;
}

export enum KnowledgeSource {
  SourceMaterial = "source_material",
  PreparedCard = "prepared_card",
  Conversation = "conversation",
  CommonKnowledge = "common_knowledge",
  PersonalExperience = "personal_experience",
}

export interface IntroducedKnowledge {
  cardId: string;
  introducedBySpeakerId: string;
  introducedAtTurn: number;
  source: KnowledgeSource;
}

export interface KnowledgeLedger {
  introducedCards: IntroducedKnowledge[];
}

export enum AudienceProfile {
  General = "general",
  Enthusiast = "enthusiast",
  Specialist = "specialist",
}

export interface ExplainedTechnicalTerm {
  term: string;
  plainLanguageMeaning: string;
  explainedBySpeakerId: string;
  explainedAtTurn: number;
}

export interface TerminologyLedger {
  explainedTerms: ExplainedTechnicalTerm[];
}

export interface ReviewedTechnicalTerm {
  term: string;
  plainLanguageMeaning: string;
}

export interface EditorialCard {
  id: string;
  materialId: string;
  kind: EditorialCardKind;
  content: string;
  /** Why this matters — the discussion angle a speaker can use to make it worth talking about, not just stating. */
  significance: string;
  evidence: EvidenceRef[];
  relatedCardIds: string[];
  tags: string[];
  /** Technical/jargon terms this card would introduce, if spoken aloud. */
  keyTerms: string[];
  /** 1-10; how surprising/vivid/engaging this would sound spoken aloud, not factual importance. */
  storyValue: number;
}

export interface PreparedMaterial {
  materialId: string;
  synopsis: string;
  cards: EditorialCard[];
}

export enum BeatPurpose {
  Welcome = "welcome",
  Hook = "hook",
  Orient = "orient",
  Explain = "explain",
  Illustrate = "illustrate",
  Surprise = "surprise",
  Explore = "explore",
  Challenge = "challenge",
  Reflect = "reflect",
  Payoff = "payoff",
  Recap = "recap",
  Close = "close",
}

export enum EnergyLevel {
  Calm = "calm",
  Curious = "curious",
  Playful = "playful",
  Energetic = "energetic",
  Tense = "tense",
  Reflective = "reflective",
  Warm = "warm",
}

export interface ConversationBeat {
  id: string;
  purpose: BeatPurpose;
  goal: string;
  cardIds: string[];
  prerequisiteBeatIds: string[];
  desiredEnergy: EnergyLevel;
  targetTurns: number;
  covered: boolean;
  coveredAtTurn?: number;
}

export enum EditorialMove {
  Explain = "explain",
  Illustrate = "illustrate",
  TellStory = "tell_story",
  AddContext = "add_context",
  Compare = "compare",
  Contrast = "contrast",
  Connect = "connect",
  Reframe = "reframe",
  Question = "question",
  Challenge = "challenge",
  React = "react",
  Humanise = "humanise",
  FindMeaning = "find_meaning",
  Summarise = "summarise",
  Transition = "transition",
}

export enum AudienceValue {
  Understanding = "understanding",
  Entertainment = "entertainment",
  Insight = "insight",
  Momentum = "momentum",
  Connection = "connection",
}

export enum ConversationalDevice {
  PersonalReaction = "personal_reaction",
  VividImage = "vivid_image",
  Humour = "humour",
  Callback = "callback",
  Contrast = "contrast",
  Reveal = "reveal",
  ThoughtExperiment = "thought_experiment",
  TrailOff = "trail_off",
}

export interface TurnBrief {
  speakerId: string;
  beatId?: string;
  goal: string;
  move: EditorialMove;
  cardIds: string[];
  audienceValue: AudienceValue;
  desiredEnergy: EnergyLevel;
  device?: ConversationalDevice;
  knowledgeSource?: KnowledgeSource;
}

export interface TurnReview {
  accepted: boolean;
  clear: boolean;
  engaging: boolean;
  grounded: boolean;
  advancesBeat: boolean;
  addsVariety: boolean;
  roleConsistent?: boolean;
  knowledgeConsistent?: boolean;
  audienceAccessible?: boolean;
  castConsistent?: boolean;
  introducedCardIds?: string[];
  introducedTerms?: ReviewedTechnicalTerm[];
  feedback?: string;
}

export interface ReviewedTurn extends TurnReview {
  revisedMessage?: string;
}

export interface PodcastScript {
  id: string;
  title: string;
  description: string;
  guidance?: string;
  speakers: Speaker[];
  speeches: Speech[];
  materials: PodcastMaterial[];
  discussionPoints: DiscussionPoint[];
  editorialCards?: EditorialCard[];
  conversationBeats?: ConversationBeat[];
  knowledgeLedger?: KnowledgeLedger;
  audienceProfile?: AudienceProfile;
  terminologyLedger?: TerminologyLedger;
  centralAnalogy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export enum ScriptEditTurnAction {
  Reuse = "reuse",
  Replace = "replace",
  Add = "add",
}

export interface EditableScriptTurn {
  sourceId?: string;
  speakerSlug: string;
  message: string;
  mode?: SpeakerAgentToolName;
}

export interface EditableScriptDocument {
  formatVersion: number;
  scriptId: string;
  revision: string;
  turns: EditableScriptTurn[];
}

export interface PlannedScriptTurn extends Omit<EditableScriptTurn, "mode"> {
  mode: SpeakerAgentToolName;
  action: ScriptEditTurnAction;
}

export interface ScriptEditSummary {
  added: number;
  removed: number;
  edited: number;
  unchanged: number;
  reordered: boolean;
}

export interface ScriptEditPlan {
  scriptId: string;
  expectedRevision: string;
  turns: PlannedScriptTurn[];
  summary: ScriptEditSummary;
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
  multispeakerChunkSize?: number;
}

export interface GenerateScriptParams {
  title: string;
  description: string;
  guidance?: string;
  speakers: Speaker[];
  materials: PodcastMaterial[];
  maxTurns: number;
  maxDuration: number; // in seconds
  allocation: SpeakerAllocation;
  audienceProfile?: AudienceProfile;
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
  roleProfile?: SpeakerRoleProfile;
  mannerisms?: string;
  physicalAppearance?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScriptRecord {
  id: string;
  title: string;
  description: string;
  guidance?: string;
  speakerIds: string[];
  speechIds: string[];
  materialIds: string[];
  discussionPoints: DiscussionPoint[];
  editorialCards?: EditorialCard[];
  conversationBeats?: ConversationBeat[];
  knowledgeLedger?: KnowledgeLedger;
  audienceProfile?: AudienceProfile;
  terminologyLedger?: TerminologyLedger;
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
  turnBrief?: TurnBrief;
  review?: TurnReview;
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

export interface MultispeakerTurn {
  speaker: Speaker;
  voice: Voice;
  text: string;
}

export interface IMultispeakerVocalProvider {
  /** Max turns per synthesizeChunk call. null = provider has no limit, whole script in one call. */
  readonly maxTurnsPerChunk: number | null;
  /** Max bytes of joined turn text per synthesizeChunk call. null = no byte limit (turn count only). */
  readonly maxBytesPerChunk: number | null;
  synthesizeChunk(turns: MultispeakerTurn[], outputFileName: string): Promise<TtsResult>;
  getVoices(): Promise<Voice[]>;
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
    forceColdOpen?: boolean,
    requestSummary?: boolean,
    isFinalTurn?: boolean,
    turnBrief?: TurnBrief,
    editorialCards?: EditorialCard[],
    audienceProfile?: AudienceProfile,
    terminologyLedger?: TerminologyLedger
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
    turnBrief: TurnBrief;
  }>;
  isConversationComplete(script: PodcastScript): Promise<boolean>;
  reviewSpeech(
    speech: Speech,
    direction: string,
    turnBrief?: TurnBrief,
    editorialCards?: EditorialCard[],
    recentSpeeches?: Speech[]
  ): Promise<Speech>;
}

export interface IMaterialPreparer {
  prepare(
    material: PodcastMaterial,
    context: { title: string; description: string }
  ): Promise<PreparedMaterial>;
}

export interface ITurnReviewer {
  review(
    speech: Speech,
    brief: TurnBrief,
    cards: EditorialCard[],
    recentSpeeches: Speech[],
    knowledgeLedger?: KnowledgeLedger,
    audienceProfile?: AudienceProfile,
    terminologyLedger?: TerminologyLedger,
    speakers?: Speaker[]
  ): Promise<ReviewedTurn>;
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
  exportScriptEditable(id: string): Promise<string>;
  planEditedScriptImport(id: string, text: string): Promise<ScriptEditPlan>;
  applyEditedScriptImport(plan: ScriptEditPlan): Promise<ScriptEditSummary>;
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
