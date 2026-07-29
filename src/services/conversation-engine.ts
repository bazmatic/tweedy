import { GenerateScriptParams, PodcastScript } from "../types";

export enum ConversationWorkflowEngineName {
  Legacy = "legacy",
  Mastra = "mastra",
}

export interface ConversationRunMetadata {
  engine: ConversationWorkflowEngineName;
  flowVersion: string;
  workflowRunId: string;
}

export interface ConversationGenerationRequest {
  script: PodcastScript;
  params: GenerateScriptParams;
  workflowRunId: string;
}

export interface ConversationGenerationResult {
  script: PodcastScript;
  metadata: ConversationRunMetadata;
}

export interface ConversationWorkflowEngine {
  readonly name: ConversationWorkflowEngineName;
  readonly flowVersion: string;
  generate(
    request: ConversationGenerationRequest
  ): Promise<ConversationGenerationResult>;
}

export type ConversationExecutor = (
  request: ConversationGenerationRequest
) => Promise<void>;

export class LegacyConversationWorkflowEngine
  implements ConversationWorkflowEngine
{
  readonly name = ConversationWorkflowEngineName.Legacy;
  readonly flowVersion = "legacy-script-service-v1";

  constructor(private readonly execute: ConversationExecutor) {}

  async generate(
    request: ConversationGenerationRequest
  ): Promise<ConversationGenerationResult> {
    await this.execute(request);
    return {
      script: request.script,
      metadata: {
        engine: this.name,
        flowVersion: this.flowVersion,
        workflowRunId: request.workflowRunId,
      },
    };
  }
}

export interface MastraEpisodeRunner {
  run(request: ConversationGenerationRequest): Promise<PodcastScript>;
}

export class MastraConversationWorkflowEngine
  implements ConversationWorkflowEngine
{
  readonly name = ConversationWorkflowEngineName.Mastra;

  constructor(
    private readonly runner: MastraEpisodeRunner,
    readonly flowVersion = "mastra-episode-v1"
  ) {}

  async generate(
    request: ConversationGenerationRequest
  ): Promise<ConversationGenerationResult> {
    const script = await this.runner.run(request);
    return {
      script,
      metadata: {
        engine: this.name,
        flowVersion: this.flowVersion,
        workflowRunId: request.workflowRunId,
      },
    };
  }
}

export class ConversationEngineSelector {
  private readonly engines: Map<
    ConversationWorkflowEngineName,
    ConversationWorkflowEngine
  >;

  constructor(
    engines: ConversationWorkflowEngine[],
    readonly defaultEngine = ConversationWorkflowEngineName.Mastra
  ) {
    this.engines = new Map(engines.map((engine) => [engine.name, engine]));
    if (!this.engines.has(defaultEngine)) {
      throw new Error(
        `Default conversation workflow engine "${defaultEngine}" is not registered`
      );
    }
  }

  resolve(
    requested: ConversationWorkflowEngineName = this.defaultEngine
  ): ConversationWorkflowEngine {
    const engine = this.engines.get(requested);
    if (!engine) {
      throw new Error(
        `Conversation workflow engine "${requested}" is not available`
      );
    }
    return engine;
  }
}

export function assertConversationRunCompatible(
  stored: ConversationRunMetadata,
  requestedEngine: ConversationWorkflowEngine
): void {
  if (
    stored.engine !== requestedEngine.name ||
    stored.flowVersion !== requestedEngine.flowVersion
  ) {
    throw new Error(
      `Cannot resume workflow run ${stored.workflowRunId}: it started with ` +
        `${stored.engine}/${stored.flowVersion}, but ` +
        `${requestedEngine.name}/${requestedEngine.flowVersion} was requested`
    );
  }
}
