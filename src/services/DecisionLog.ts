import * as fs from "fs";
import * as path from "path";

export interface DecisionRecord {
  judgment: string;
  timestamp: string;
  state?: unknown;
  value: unknown;
  /** Supporting detail from the provider, e.g. raw probabilities. */
  detail?: unknown;
  usedFallback: boolean;
  fallbackReason?: string;
}

export class JsonlDecisionLog {
  constructor(readonly filePath: string) {}

  async append(record: DecisionRecord): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.promises.appendFile(this.filePath, JSON.stringify(record) + "\n", "utf8");
  }

  async readAll(): Promise<DecisionRecord[]> {
    let contents: string;
    try {
      contents = await fs.promises.readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return contents
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as DecisionRecord);
  }
}

export interface DecisionSummary {
  judgment: string;
  total: number;
  fallbacks: number;
  /** Answers close to a coin flip (see isLowConfidence). */
  lowConfidence: number;
}

const LOW_CONFIDENCE_MARGIN = 0.15;

/** True when the logged detail shows a near-even answer. */
export function isLowConfidence(detail: unknown): boolean {
  if (!detail || typeof detail !== "object") return false;
  const values = Object.entries(detail as Record<string, unknown>)
    .filter(([key]) => /confidence|probabilit/i.test(key))
    .flatMap(([, v]) => (typeof v === "number" ? [v] : v && typeof v === "object" ? Object.values(v as object) : []))
    .filter((v): v is number => typeof v === "number");
  return values.some((v) => Math.abs(v - 0.5) < LOW_CONFIDENCE_MARGIN);
}

export function summarizeDecisions(records: DecisionRecord[]): DecisionSummary[] {
  const byJudgment = new Map<string, DecisionSummary>();
  for (const record of records) {
    const summary = byJudgment.get(record.judgment) ?? {
      judgment: record.judgment,
      total: 0,
      fallbacks: 0,
      lowConfidence: 0,
    };
    summary.total++;
    if (record.usedFallback) summary.fallbacks++;
    else if (isLowConfidence(record.detail)) summary.lowConfidence++;
    byJudgment.set(record.judgment, summary);
  }
  return [...byJudgment.values()].sort((a, b) => a.judgment.localeCompare(b.judgment));
}
