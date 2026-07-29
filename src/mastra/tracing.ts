import { promises as fs } from "fs";
import * as path from "path";
import { ModelTask } from "../providers/ModelRoutingPolicy";

const SENSITIVE_KEY = /(?:api[-_]?key|authorization|credential|password|secret|token)$/i;
const SOURCE_KEY = /(?:document|prompt|source|excerpt|content|material)/i;
const MAX_SAFE_TEXT = 160;

export const REDACTED = "[REDACTED]";

export function redactTraceValue(value: unknown, key = ""): unknown {
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  if (typeof value === "string") {
    if (SOURCE_KEY.test(key) || value.length > MAX_SAFE_TEXT) return REDACTED;
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactTraceValue(item, key));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redactTraceValue(childValue, childKey),
      ])
    );
  }
  return value;
}

export interface TweedyTrace {
  episodeId: string;
  runId: string;
  flowVersion: string;
  modelTask: ModelTask;
  logicalTurn?: number;
  retryCount: number;
  latencyMs: number;
  tokenUsage?: { input?: number; output?: number; total?: number };
  outcome?: "proposed" | "repaired" | "completed" | "failed";
  acceptedSpeechId?: string;
  attributes?: Record<string, unknown>;
}

export interface TraceSink {
  export(trace: TweedyTrace): Promise<void>;
}

export class InMemoryTraceSink implements TraceSink {
  readonly traces: TweedyTrace[] = [];

  async export(trace: TweedyTrace): Promise<void> {
    this.traces.push(redactTraceValue(trace) as TweedyTrace);
  }
}

export class JsonlTraceSink implements TraceSink {
  constructor(private readonly filePath: string) {}

  async export(trace: TweedyTrace): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const safeTrace = redactTraceValue(trace);
    await fs.appendFile(this.filePath, `${JSON.stringify(safeTrace)}\n`, "utf8");
  }
}
