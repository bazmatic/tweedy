export enum ModelTask {
  MaterialPreparation = "material_preparation",
  MaterialSummary = "material_summary",
  EpisodePlanning = "episode_planning",
  DirectionSelection = "direction_selection",
  SpeechGeneration = "speech_generation",
  TurnReview = "turn_review",
  CoverageVerification = "coverage_verification",
  ConclusionCheck = "conclusion_check",
  Interjection = "interjection",
  SpeechEffectTagging = "speech_effect_tagging",
  SpeechCondensing = "speech_condensing",
}

export enum ModelTier {
  Economy = "economy",
  Balanced = "balanced",
  Premium = "premium",
}

const DEFAULT_TIER_BY_TASK: Record<ModelTask, ModelTier> = {
  [ModelTask.MaterialPreparation]: ModelTier.Premium,
  [ModelTask.MaterialSummary]: ModelTier.Premium,
  [ModelTask.EpisodePlanning]: ModelTier.Premium,
  [ModelTask.DirectionSelection]: ModelTier.Balanced,
  [ModelTask.SpeechGeneration]: ModelTier.Premium,
  [ModelTask.TurnReview]: ModelTier.Premium,
  [ModelTask.CoverageVerification]: ModelTier.Economy,
  [ModelTask.ConclusionCheck]: ModelTier.Economy,
  [ModelTask.Interjection]: ModelTier.Economy,
  [ModelTask.SpeechEffectTagging]: ModelTier.Economy,
  [ModelTask.SpeechCondensing]: ModelTier.Economy,
};

// Speech-facing tasks get a higher temperature for more varied, natural-
// sounding delivery; everything else keeps the provider default (undefined).
// Card preparation also benefits from more varied editorial output rather
// than the same handful of angles every time.
const TEMPERATURE_BY_TASK: Partial<Record<ModelTask, number>> = {
  [ModelTask.SpeechGeneration]: 1.275,
  [ModelTask.Interjection]: 1.2,
  [ModelTask.MaterialPreparation]: 1.2,
  [ModelTask.SpeechCondensing]: 0.4,
};

/**
 * Assigns each known application task to a cost and quality tier. The mapping
 * is deliberately deterministic: no model call is spent deciding which model
 * should handle another model call.
 */
export class ModelRoutingPolicy {
  resolve(task: ModelTask): ModelTier {
    return DEFAULT_TIER_BY_TASK[task];
  }

  resolveTemperature(task: ModelTask): number | undefined {
    return TEMPERATURE_BY_TASK[task];
  }
}
