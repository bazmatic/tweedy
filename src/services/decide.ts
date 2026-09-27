import { logger } from "../utils/logger";
import { getDecisionLog } from "./judgment-runtime";

/** A provider's answer to one decision, or why it could not give one. */
export type JudgmentDecision<T> =
  | { status: "ok"; value: T; detail?: unknown }
  | { status: "unavailable"; reason: string };

export interface DecideCall<T> {
  /** Stable name, e.g. "coverage.point"; used in warnings and the log. */
  judgment: string;
  ask: () => Promise<JudgmentDecision<T>>;
  /** The fail-safe value used when the provider cannot answer. */
  fallback: T;
  /** Inputs recorded in the decision log. */
  state?: unknown;
}

/**
 * Makes one decision through the judgment provider. Never throws: if the
 * provider is unavailable or fails, returns the decision's fail-safe default.
 */
export async function decide<T>(call: DecideCall<T>): Promise<T> {
  let decision: JudgmentDecision<T>;
  try {
    decision = await call.ask();
  } catch (error) {
    decision = { status: "unavailable", reason: error instanceof Error ? error.message : String(error) };
  }

  const usedFallback = decision.status !== "ok";
  const value = decision.status === "ok" ? decision.value : call.fallback;
  if (decision.status !== "ok") {
    logger.warn(`Judgment "${call.judgment}" unavailable (${decision.reason}); using its fail-safe default`);
  }

  const log = getDecisionLog();
  if (log) {
    try {
      await log.append({
        judgment: call.judgment,
        timestamp: new Date().toISOString(),
        state: call.state,
        value,
        ...(decision.status === "ok" && decision.detail !== undefined ? { detail: decision.detail } : {}),
        usedFallback,
        ...(decision.status !== "ok" ? { fallbackReason: decision.reason } : {}),
      });
    } catch (error) {
      logger.warn(`Failed to log judgment "${call.judgment}":`, error);
    }
  }
  return value;
}
