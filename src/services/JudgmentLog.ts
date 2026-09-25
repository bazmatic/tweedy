import * as fs from "fs";
import * as path from "path";
import { JudgmentMode } from "./judgment-modes";

export interface JudgmentRecord {
  judgment: string;
  mode: Exclude<JudgmentMode, "off">;
  timestamp: string;
  /** The inputs both paths judged, so a disagreement can be inspected. */
  state?: unknown;
  current?: unknown;
  /** TypeSafe's decision, when it was available. */
  typesafe?: unknown;
  typesafeUnavailableReason?: string;
  /** Present only when both decisions exist and could be compared. */
  agreed?: boolean;
  /** Which decision was acted on. */
  actedOn: "current" | "typesafe";
}

export interface IJudgmentLog {
  append(record: JudgmentRecord): Promise<void>;
  readAll(): Promise<JudgmentRecord[]>;
}

/** Append-only JSONL log of shadowed and live TypeSafe judgments. */
export class JsonlJudgmentLog implements IJudgmentLog {
  constructor(private readonly filePath: string) {}

  async append(record: JudgmentRecord): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.promises.appendFile(
      this.filePath,
      JSON.stringify(record) + "\n",
      "utf8"
    );
  }

  async readAll(): Promise<JudgmentRecord[]> {
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
      .map((line) => JSON.parse(line) as JudgmentRecord);
  }
}

export interface JudgmentAgreementSummary {
  judgment: string;
  total: number;
  compared: number;
  agreed: number;
  disagreed: number;
  unavailable: number;
  /** agreed / compared, or undefined when nothing could be compared. */
  agreementRate?: number;
}

export function summarizeAgreement(
  records: JudgmentRecord[]
): JudgmentAgreementSummary[] {
  const byJudgment = new Map<string, JudgmentAgreementSummary>();
  for (const record of records) {
    const summary = byJudgment.get(record.judgment) ?? {
      judgment: record.judgment,
      total: 0,
      compared: 0,
      agreed: 0,
      disagreed: 0,
      unavailable: 0,
    };
    summary.total++;
    if (record.typesafeUnavailableReason !== undefined) summary.unavailable++;
    if (record.agreed === true) {
      summary.compared++;
      summary.agreed++;
    } else if (record.agreed === false) {
      summary.compared++;
      summary.disagreed++;
    }
    byJudgment.set(record.judgment, summary);
  }

  return [...byJudgment.values()]
    .map((summary) => ({
      ...summary,
      agreementRate:
        summary.compared > 0 ? summary.agreed / summary.compared : undefined,
    }))
    .sort((a, b) => a.judgment.localeCompare(b.judgment));
}
