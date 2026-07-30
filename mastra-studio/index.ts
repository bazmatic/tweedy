import * as path from "path";
import { loadConfig } from "../src/utils/config";
import { createTweedyMastra } from "../src/mastra";
import { EpisodeWorkflowDependencies } from "../src/mastra/episode-workflow";

/**
 * Studio only needs the "generate-episode" workflow *registered* so it can
 * list and inspect already-persisted runs from storage — it never actually
 * re-executes a step from this process. Every method below throws if called,
 * to fail loudly rather than silently produce fake content if Studio ever
 * does try to trigger a fresh run.
 */
function unusedInStudio(name: string): never {
  throw new Error(
    `${name} is not wired for mastra-studio — this entry only registers the workflow for inspecting past runs, it cannot execute new ones.`
  );
}

const inspectionOnlyDependencies: EpisodeWorkflowDependencies = {
  prepareMaterials: () => unusedInStudio("prepareMaterials"),
  assignSpeakerRoles: () => unusedInStudio("assignSpeakerRoles"),
  createPlan: () => unusedInStudio("createPlan"),
  inspectEpisode: () => unusedInStudio("inspectEpisode"),
  proposeTurn: () => unusedInStudio("proposeTurn"),
  repairTurn: () => unusedInStudio("repairTurn"),
  forceClosingTurn: () => unusedInStudio("forceClosingTurn"),
  generateCandidate: () => unusedInStudio("generateCandidate"),
  reviewCandidate: () => unusedInStudio("reviewCandidate"),
  validateIntegrity: () => unusedInStudio("validateIntegrity"),
  validateRepetition: () => unusedInStudio("validateRepetition"),
  persistCandidate: () => unusedInStudio("persistCandidate"),
};

/**
 * Entry point for `mastra dev` / Mastra Studio only — never imported by the
 * CLI. Kept outside src/mastra so that module keeps its "importing has no
 * side effects" guarantee; this file intentionally constructs a real
 * instance pointed at this project's actual storage and trace files (same
 * paths `tweedy` writes to) so past generation runs can be inspected.
 *
 * Paths must be absolute and independent of process.cwd(): the bundled dev
 * server relocates its working directory (observed at
 * mastra-studio/public/...), so neither a relative path nor process.cwd()
 * reliably points back at this repo. TWEEDY_PROJECT_ROOT lets this be
 * overridden; it defaults to this repo's own known location since this file
 * is never shipped or imported outside local development.
 */
const projectRoot =
  process.env.TWEEDY_PROJECT_ROOT ??
  "/Users/barryearsman/projects/personal/tweedy";
const config = loadConfig();

export const { mastra } = createTweedyMastra({
  storagePath: path.resolve(projectRoot, config.mastraStoragePath),
  tracePath: path.resolve(projectRoot, config.mastraTracePath),
  episodeWorkflowDependencies: inspectionOnlyDependencies,
});
