import {
  IScriptService,
  PodcastScript,
  GenerateScriptParams,
  Speaker,
  PodcastMaterial,
  Speech,
} from "../types";
import {
  ScriptRepository,
  SpeakerRepository,
  MaterialRepository,
  VoiceRepository,
  SpeechRepository,
} from "../repositories";
import { DirectorAgent, SpeakerAgent } from "../agents";
import { logger } from "../utils/logger";
import { shouldInterject } from "./interjection-policy";
import { RAGService } from "../rag";

export class ScriptService implements IScriptService {
  constructor(
    private readonly scriptRepository: ScriptRepository,
    private readonly speakerRepository: SpeakerRepository,
    private readonly materialRepository: MaterialRepository,
    private readonly voiceRepository: VoiceRepository,
    private readonly speechRepository: SpeechRepository,
    private readonly ragService: RAGService
  ) {}

  async generateScript(params: GenerateScriptParams): Promise<PodcastScript> {
    try {
      logger.info(`Generating script: ${params.title}`);

      // Load speakers and materials
      const speakers = await this.loadSpeakers(params.speakers);
      const materials = await this.loadMaterials(params.materials);

      // Create initial script
      const script: PodcastScript = {
        id: "",
        title: params.title,
        description: params.description,
        speakers,
        speeches: [],
        materials,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Generate script using AI agents
      await this.generateScriptContent(script, params);

      // Save script
      await this.saveScript(script);

      logger.success(`Script generated successfully: ${script.title}`);
      return script;
    } catch (error) {
      logger.error("Failed to generate script:", error);
      throw error;
    }
  }

  async getScript(id: string): Promise<PodcastScript> {
    const record = await this.scriptRepository.getById(id);
    if (!record) {
      throw new Error(`Script with id ${id} not found`);
    }
    return await this.loadScriptFromRecord(record);
  }

  async getAllScripts(): Promise<PodcastScript[]> {
    const records = await this.scriptRepository.getAll();
    const scripts: PodcastScript[] = [];

    for (const record of records) {
      try {
        const script = await this.loadScriptFromRecord(record);
        scripts.push(script);
      } catch (error) {
        logger.warn(`Failed to load script ${record.id}:`, error);
      }
    }

    return scripts;
  }

  async deleteScript(id: string): Promise<void> {
    const deleted = await this.scriptRepository.delete(id);
    if (!deleted) {
      throw new Error(`Script with id ${id} not found`);
    }
  }

  async exportScriptAsText(id: string): Promise<string> {
    const script = await this.getScript(id);

    const lines: string[] = [];
    lines.push(script.title);
    lines.push("=".repeat(script.title.length));
    if (script.description) {
      lines.push("");
      lines.push(script.description);
    }
    lines.push("");
    lines.push(`Speakers: ${script.speakers.map((s) => s.name).join(", ")}`);
    lines.push(`Created: ${script.createdAt.toLocaleDateString()}`);
    lines.push("");

    for (const speech of script.speeches) {
      lines.push(`${speech.speaker.name}: ${speech.message}`);
      lines.push("");
    }

    return lines.join("\n").trimEnd() + "\n";
  }

  private async loadSpeakers(speakerConfigs: any[]): Promise<Speaker[]> {
    const speakers: Speaker[] = [];

    for (const config of speakerConfigs) {
      const speakerRecord =
        (await this.speakerRepository.findBySlug(config.id)) ||
        (await this.speakerRepository.getById(config.id));
      if (!speakerRecord) {
        throw new Error(
          `Speaker '${config.id}' not found (tried as slug and id)`
        );
      }

      // Load voice for speaker
      const voiceRecord = await this.voiceRepository.getById(
        speakerRecord.voiceId
      );
      if (!voiceRecord) {
        throw new Error(`Voice for speaker ${speakerRecord.name} not found`);
      }

      // Create speaker with voice
      speakers.push({
        id: speakerRecord.id,
        slug: speakerRecord.slug,
        name: speakerRecord.name,
        personality: speakerRecord.personality,
        voice: {
          id: voiceRecord.id,
          name: voiceRecord.name,
          description: voiceRecord.description,
          provider: voiceRecord.provider,
          providerId: voiceRecord.providerId,
          settings: voiceRecord.settings,
        },
        voiceStyle: speakerRecord.voiceStyle,
        isExpert: speakerRecord.isExpert,
      });
    }

    return speakers;
  }

  private async loadMaterials(
    materialConfigs: any[]
  ): Promise<PodcastMaterial[]> {
    const materials: PodcastMaterial[] = [];

    for (const config of materialConfigs) {
      const materialRecord = await this.materialRepository.getById(config.id);
      if (!materialRecord) {
        throw new Error(`Material with id ${config.id} not found`);
      }

      materials.push({
        id: materialRecord.id,
        title: materialRecord.title,
        content: materialRecord.content,
        source: materialRecord.source,
        sourceType: materialRecord.sourceType,
        metadata: materialRecord.metadata,
        createdAt: materialRecord.createdAt,
      });
    }

    return materials;
  }

  private async generateScriptContent(
    script: PodcastScript,
    params: GenerateScriptParams
  ): Promise<void> {
    const directorAgent = new DirectorAgent(script, {
      maxTurns: params.maxTurns,
      maxDuration: params.maxDuration,
    });
    await directorAgent.createPodcastPlan();
    try {
      await this.ragService.addMaterials(script.materials);
    } catch (error) {
      logger.warn(
        "Failed to add script materials to RAG store; continuing without semantic material search:",
        error
      );
    }

    for (let turn = 0; turn < params.maxTurns; turn++) {
      const { speaker, direction, timeStatus, forceNearlyOutOfTime } =
        await directorAgent.chooseNextSpeaker(script);
      const speakerAgent = new SpeakerAgent(speaker, this.ragService);

      const speech = await speakerAgent.speak(
        script,
        direction,
        timeStatus,
        forceNearlyOutOfTime
      );
      await this.persistSpeech(script, speech);

      // If that turn ran long — or was cut off by the token limit — let a
      // different speaker chime in with a quick reaction before the director
      // picks the next real turn — real overlap instead of relying on the
      // speaker to self-select a short tool. Skip on the final turn so the
      // closing statement is the last thing said, not a context-blind reaction.
      const isFinalTurn = turn === params.maxTurns - 1;
      if (
        !isFinalTurn &&
        shouldInterject(speech, script.speakers.length, Math.random())
      ) {
        const eligibleInterjectors = script.speakers.filter(
          (s) => s.id !== speaker.id
        );
        const interjector =
          eligibleInterjectors[
            Math.floor(Math.random() * eligibleInterjectors.length)
          ];
        const interjectionAgent = new SpeakerAgent(
          interjector,
          this.ragService
        );
        const interjection = await interjectionAgent.interject(script);
        await this.persistSpeech(script, interjection);
      }
    }
  }

  private async persistSpeech(
    script: PodcastScript,
    speech: Speech
  ): Promise<void> {
    const speechRecord = await this.speechRepository.create({
      speakerId: speech.speaker.id,
      message: speech.message,
      instructions: speech.instructions,
      voiceId: speech.voice.id,
      voiceStyle: speech.voiceStyle,
      timestamp: speech.timestamp,
      tool: speech.tool,
      stopReason: speech.stopReason,
    });

    speech.id = speechRecord.id;

    script.speeches.push(speech);
    script.updatedAt = new Date();
  }

  private async loadScriptFromRecord(record: any): Promise<PodcastScript> {
    // Load speakers
    const speakers = await this.loadSpeakers(
      record.speakerIds.map((id: string) => ({ id }))
    );

    // Load materials
    const materials = await this.loadMaterials(
      record.materialIds.map((id: string) => ({ id }))
    );

    // Load speeches
    const speeches: any[] = [];
    for (const speechId of record.speechIds) {
      const speechRecord = await this.speechRepository.getById(speechId);
      if (speechRecord) {
        // Find the speaker for this speech
        const speaker = speakers.find((s) => s.id === speechRecord.speakerId);
        if (speaker) {
          speeches.push({
            id: speechRecord.id,
            speaker,
            message: speechRecord.message,
            instructions: speechRecord.instructions,
            voice: speaker.voice,
            voiceStyle: speechRecord.voiceStyle,
            timestamp: speechRecord.timestamp,
            tool: speechRecord.tool,
            stopReason: speechRecord.stopReason,
          });
        }
      }
    }

    return {
      id: record.id,
      title: record.title,
      description: record.description,
      speakers,
      speeches,
      materials,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
    };
  }

  private async saveScript(script: PodcastScript): Promise<void> {
    const record = {
      title: script.title,
      description: script.description,
      speakerIds: script.speakers.map((s) => s.id),
      speechIds: script.speeches.map((s) => s.id),
      materialIds: script.materials.map((m) => m.id),
    };

    const created = await this.scriptRepository.create(record);
    script.id = created.id;
    script.createdAt = created.createdAt;
    script.updatedAt = created.updatedAt;
  }
}
