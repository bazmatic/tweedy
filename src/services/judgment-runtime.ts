import * as path from "path";
import { appConfig } from "../utils/config";
import { TypeSafeJudgmentProvider } from "../providers/TypeSafeJudgmentProvider";
import { IJudgmentProvider } from "../providers/judgment-questions";
import { JsonlJudgmentLog } from "./JudgmentLog";
import { JudgmentRunner } from "./JudgmentRunner";
import {
  JudgmentMode,
  JudgmentModes,
  parseJudgmentModes,
  resolveJudgmentMode,
} from "./judgment-modes";

export function judgmentLogPath(): string {
  return (
    process.env.TYPESAFE_JUDGMENT_LOG_PATH ||
    path.join(appConfig.dataDir, "judgments", "judgments.jsonl")
  );
}

let sharedModes: JudgmentModes | undefined;
let sharedRunner: JudgmentRunner | undefined;
let sharedProvider: IJudgmentProvider | undefined;

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

/** Process-wide TypeSafe provider configured from TYPESAFE_API_KEY. */
export function getJudgmentProvider(): IJudgmentProvider {
  sharedProvider ??= new TypeSafeJudgmentProvider();
  return sharedProvider;
}
