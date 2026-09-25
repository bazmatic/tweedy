import * as path from "path";
import { appConfig } from "../utils/config";
import { TypeSafeJudgmentProvider } from "../providers/TypeSafeJudgmentProvider";
import { IJudgmentProvider } from "../providers/judgment-questions";
import { JsonlJudgmentLog } from "./JudgmentLog";
import { JudgmentRunner } from "./JudgmentRunner";
import { parseJudgmentModes } from "./judgment-modes";

export function judgmentLogPath(): string {
  return (
    process.env.TYPESAFE_JUDGMENT_LOG_PATH ||
    path.join(appConfig.dataDir, "judgments", "judgments.jsonl")
  );
}

let sharedRunner: JudgmentRunner | undefined;
let sharedProvider: IJudgmentProvider | undefined;

/** Process-wide runner configured from TYPESAFE_JUDGMENTS. */
export function getJudgmentRunner(): JudgmentRunner {
  sharedRunner ??= new JudgmentRunner(
    parseJudgmentModes(process.env.TYPESAFE_JUDGMENTS),
    new JsonlJudgmentLog(judgmentLogPath())
  );
  return sharedRunner;
}

/** Process-wide TypeSafe provider configured from TYPESAFE_API_KEY. */
export function getJudgmentProvider(): IJudgmentProvider {
  sharedProvider ??= new TypeSafeJudgmentProvider();
  return sharedProvider;
}
