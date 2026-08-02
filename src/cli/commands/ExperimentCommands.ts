import { Command, Option } from "commander";
import {
  MaterialRepository,
  ScriptRepository,
  SpeakerRepository,
  SpeechRepository,
  VoiceRepository,
} from "../../repositories";
import { RAGService } from "../../rag";
import { ScriptService } from "../../services/ScriptService";
import { MastraScriptWorkflowRunner } from "../../services/MastraScriptWorkflowRunner";
import { createTweedyMastra } from "../../mastra";
import { ensureExperimentDataset } from "../../mastra/experiment/dataset";
import { resolveScriptId, seedExperimentDataset } from "../../mastra/experiment/dataset-items";
import { appConfig } from "../../utils/config";
import { logger } from "../../utils/logger";

// Mastra's dataset experiment runner defaults maxConcurrency to 5. Every
// concurrent item here is a full episode generation (real API cost) plus,
// when transcript-quality is among the scorers, an LLM-judge call — so this
// CLI defaults lower than Mastra's built-in default and requires an
// explicit --concurrency to go higher.
const DEFAULT_EXPERIMENT_CONCURRENCY = 2;

export function createExperimentCommands(): Command {
  const experimentCommand = new Command("experiment");

  const scriptRepository = new ScriptRepository();
  const speakerRepository = new SpeakerRepository();
  const materialRepository = new MaterialRepository();
  const voiceRepository = new VoiceRepository();
  const speechRepository = new SpeechRepository();
  const ragService = new RAGService();
  const scriptService = new ScriptService(
    scriptRepository,
    speakerRepository,
    materialRepository,
    voiceRepository,
    speechRepository,
    ragService
  );

  function buildMastra() {
    return createTweedyMastra({
      storagePath: appConfig.mastraStoragePath,
      tracePath: appConfig.mastraTracePath,
      experimentWorkflowDependencies: {
        runner: new MastraScriptWorkflowRunner(speechRepository, ragService),
        loadScript: (scriptId) => scriptService.getScript(scriptId),
      },
    });
  }

  experimentCommand
    .command("seed")
    .description("Seed the podcast-episode-experiments dataset with run-parameter sweeps for a script")
    .addOption(new Option("-s, --script-id <id>", "Script id to seed (defaults to the most recently modified script)"))
    .action(async (options) => {
      try {
        const { mastra } = buildMastra();
        const dataset = await ensureExperimentDataset(mastra);
        const scriptId = await resolveScriptId(appConfig.scriptsDir, options.scriptId);
        const items = await seedExperimentDataset(dataset, scriptId);
        logger.success(`Seeded ${items.length} dataset item(s) for script ${scriptId}`);
      } catch (error) {
        logger.error("Failed to seed the experiment dataset:", error);
      }
    });

  experimentCommand
    .command("run")
    .description("Run every item currently in the podcast-episode-experiments dataset")
    .addOption(new Option("-n, --name <name>", "Name for this experiment run").makeOptionMandatory())
    .addOption(
      new Option(
        "-c, --concurrency <n>",
        `Maximum concurrent episode generations (default: ${DEFAULT_EXPERIMENT_CONCURRENCY}). Each concurrent item is a full episode generation plus scoring — real API cost — so this is kept lower than Mastra's built-in default of 5. Raise with care.`
      ).default(String(DEFAULT_EXPERIMENT_CONCURRENCY))
    )
    .action(async (options) => {
      try {
        const maxConcurrency = parseInt(options.concurrency, 10);
        if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
          logger.error(`Invalid --concurrency value: ${options.concurrency}`);
          return;
        }
        const { mastra } = buildMastra();
        const dataset = await ensureExperimentDataset(mastra);
        const listResult = await dataset.listItems();
        const itemCount = Array.isArray(listResult) ? listResult.length : listResult.pagination.total;
        logger.progress(`Running ${itemCount} item(s) at concurrency ${maxConcurrency}`);
        const summary = await dataset.startExperiment({
          name: options.name,
          targetType: "workflow",
          targetId: "episodeExperimentRun",
          scorers: ["transcript-quality", "rejection-repair-rate"],
          maxConcurrency,
        });
        logger.success(
          `Experiment "${options.name}": ${summary.succeededCount} succeeded, ${summary.failedCount} failed, ${summary.skippedCount} skipped`
        );
      } catch (error) {
        logger.error("Failed to run the experiment:", error);
      }
    });

  return experimentCommand;
}
