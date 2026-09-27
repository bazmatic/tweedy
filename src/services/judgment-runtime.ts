import * as path from "path";
import { appConfig } from "../utils/config";
import { IJudgmentProvider } from "../providers/judgment-questions";
import { JsonlJudgmentLog } from "./JudgmentLog";
import { JudgmentRunner } from "./JudgmentRunner";
import {
  JudgmentMode,
  JudgmentModes,
  parseJudgmentModes,
  resolveJudgmentMode,
} from "./judgment-modes";
import { JudgmentProviderName } from "../types";
import { JudgmentProviderFactory } from "../providers/JudgmentProviderFactory";
import { JsonlDecisionLog } from "./DecisionLog";
import { getJudgmentProviderOverride } from "./judgment-provider-state";

export { setJudgmentProvider } from "./judgment-provider-state";

export function judgmentLogPath(): string {
  return (
    process.env.TYPESAFE_JUDGMENT_LOG_PATH ||
    path.join(appConfig.dataDir, "judgments", "judgments.jsonl")
  );
}

let sharedModes: JudgmentModes | undefined;
let sharedRunner: JudgmentRunner | undefined;

function judgmentModes(): JudgmentModes {
  sharedModes ??= parseJudgmentModes(process.env.TYPESAFE_JUDGMENTS);
  return sharedModes;
}

/**
 * The configured rollout mode for a judgment. For callers whose own
 * behaviour depends on whether TypeSafe is acting, e.g. widening a check
 * that is only affordable when TypeSafe makes it.
 */
export function judgmentMode(judgment: string): JudgmentMode {
  return resolveJudgmentMode(judgmentModes(), judgment);
}

/** Process-wide runner configured from TYPESAFE_JUDGMENTS. */
export function getJudgmentRunner(): JudgmentRunner {
  sharedRunner ??= new JudgmentRunner(
    judgmentModes(),
    new JsonlJudgmentLog(judgmentLogPath())
  );
  return sharedRunner;
}

/**
 * The active judgment provider: a test override installed via
 * `setJudgmentProvider`, or the process-wide TypeSafe provider (configured
 * from TYPESAFE_API_KEY) otherwise.
 */
export function getJudgmentProvider(): IJudgmentProvider {
  return getJudgmentProviderOverride() ?? JudgmentProviderFactory.getProvider(JudgmentProviderName.TypeSafe);
}

let decisionLog: JsonlDecisionLog | undefined;

/** The opt-in decision log, or undefined when JUDGMENT_LOG_PATH is unset. */
export function getDecisionLog(): JsonlDecisionLog | undefined {
  const logPath = process.env.JUDGMENT_LOG_PATH;
  if (!logPath) return undefined;
  if (decisionLog?.filePath !== logPath) decisionLog = new JsonlDecisionLog(logPath);
  return decisionLog;
}
