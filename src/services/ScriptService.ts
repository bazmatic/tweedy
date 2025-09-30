import {
  IScriptService,
  PodcastScript,
  GenerateScriptParams,
  Speaker,
  PodcastMaterial,
} from "../types";
import {
  ScriptRepository,
  SpeakerRepository,
  MaterialRepository,
} from "../repositories";
import { DirectorAgent, SpeakerAgent } from "../agents";
import { logger } from "../utils/logger";

export class ScriptService implements IScriptService {
  constructor(
    private readonly scriptRepository: ScriptRepository,
    private readonly speakerRepository: SpeakerRepository,
    private readonly materialRepository: MaterialRepository
  ) {}

  async generateScript(params: GenerateScriptParams): Promise<PodcastScript> {
    try {
      logger.info(`Generating script: ${params.title}`);

      // Load speakers and materials
      const speakers = await this.loadSpeakers(params.speakers);
      const materials = await this.loadMaterials(params.materials);

      // Create initial script
      const script: PodcastScript = {
        id: this.generateId(),
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

  private async loadSpeakers(speakerConfigs: any[]): Promise<Speaker[]> {
    const speakers: Speaker[] = [];

    for (const config of speakerConfigs) {
      const speakerRecord = await this.speakerRepository.getById(config.id);
      if (!speakerRecord) {
        throw new Error(`Speaker with id ${config.id} not found`);
      }

      // Load voice for speaker
      const voiceRecord = await this.speakerRepository.getById(
        speakerRecord.voiceId
      );
      if (!voiceRecord) {
        throw new Error(`Voice for speaker ${speakerRecord.name} not found`);
      }

      // This is a simplified version - in practice you'd need proper voice loading
      speakers.push({
        id: speakerRecord.id,
        name: speakerRecord.name,
        personality: speakerRecord.personality,
        voice: {} as any, // Simplified for now
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
    const directorAgent = new DirectorAgent(script);
    await directorAgent.createPodcastPlan();

    let currentSpeakerIndex = 0;

    for (let turn = 0; turn < params.maxTurns; turn++) {
      const speaker = script.speakers[currentSpeakerIndex];
      const speakerAgent = new SpeakerAgent(speaker);

      const direction = await directorAgent.giveDirection(speakerAgent);
      const speech = await speakerAgent.speak(script, direction);

      script.speeches.push(speech);
      script.updatedAt = new Date();

      currentSpeakerIndex = (currentSpeakerIndex + 1) % script.speakers.length;
    }
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

    // Load speeches (simplified - in practice you'd need a speech repository)
    const speeches: any[] = []; // Simplified for now

    return {
      id: record.id,
      title: record.title,
      description: record.description,
      speakers,
      speeches,
      materials,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
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

    await this.scriptRepository.create(record);
  }

  private generateId(): string {
    return Math.random().toString(36).substr(2, 9);
  }
}
