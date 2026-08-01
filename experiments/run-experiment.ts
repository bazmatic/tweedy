// experiments/run-experiment.ts
import * as path from "path";
import { Mastra } from "@mastra/core/mastra";
import { LibSQLStore } from "@mastra/libsql";
import {
  MaterialRepository,
  ScriptRepository,
  SpeakerRepository,
  SpeechRepository,
  VoiceRepository,
} from "../src/repositories";
import { RAGService } from "../src/rag";
import { ScriptService } from "../src/services/ScriptService";
import { MastraScriptWorkflowRunner } from "../src/services/MastraScriptWorkflowRunner";
import { appConfig } from "../src/utils/config";
import { createExperimentWorkflow } from "../src/mastra/experiment/experiment-workflow";
import { resolveScriptId, buildExperimentItems } from "../src/mastra/experiment/dataset-items";
import { createRejectionRepairRateScorer } from "../src/mastra/experiment/rejection-repair-rate-scorer";
import { createTranscriptQualityScorer } from "../src/mastra/experiment/transcript-quality-scorer";

const DATASET_NAME = "episode-dynamics";

function parseArgs(argv: string[]): { scriptId?: string; runName: string } {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new Error(`Expected --flag value pairs, got "${flag}"`);
    }
    args.set(flag.slice(2), value);
  }
  const runName = args.get("run-name");
  if (!runName) {
    throw new Error("Missing required --run-name <baseline|candidate|...>");
  }
  return { scriptId: args.get("script-id"), runName };
}

async function main(): Promise<void> {
  const { scriptId: explicitScriptId, runName } = parseArgs(process.argv.slice(2));

  const scriptId = await resolveScriptId(appConfig.scriptsDir, explicitScriptId);

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

  const runDir = path.join(process.cwd(), "data", "experiments", runName);
  const runnerStoragePath = path.join(runDir, "mastra.db");
  const tracePath = path.join(runDir, "mastra-traces.jsonl");

  const runner = new MastraScriptWorkflowRunner(
    speechRepository,
    ragService,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { storagePath: runnerStoragePath, tracePath }
  );

  const experimentWorkflow = createExperimentWorkflow({
    runner,
    loadScript: (id) => scriptService.getScript(id),
  });

  const experimentStoragePath = path.join(runDir, "experiment-store.db");
  const mastra = new Mastra({
    storage: new LibSQLStore({
      id: `experiment-store-${runName}`,
      url: `file:${experimentStoragePath}`,
    }),
    workflows: { episodeExperimentRun: experimentWorkflow },
  });

  const datasets = mastra.datasets;
  const { datasets: existingDatasets } = await datasets.list();
  const existing = existingDatasets.find((entry) => entry.name === DATASET_NAME);
  const dataset = existing
    ? await datasets.get({ id: existing.id })
    : await datasets.create({ name: DATASET_NAME });

  const { items: existingItems } = await dataset.listItems({ perPage: 1 });
  if (existingItems.length === 0) {
    await dataset.addItems({ items: buildExperimentItems(scriptId) });
  }

  const summary = await dataset.startExperiment({
    name: `${runName}-${new Date().toISOString()}`,
    targetType: "workflow",
    targetId: "episodeExperimentRun",
    scorers: [createRejectionRepairRateScorer(tracePath), createTranscriptQualityScorer()],
  });

  console.log(`Status: ${summary.status}`);
  console.log(`${summary.succeededCount}/${summary.totalItems} succeeded`);
  for (const item of summary.results) {
    console.log(`\nItem ${item.itemId} (input: ${JSON.stringify(item.input)})`);
    for (const score of item.scores) {
      console.log(`  ${score.scorerName}: ${score.score} — ${score.reason}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
