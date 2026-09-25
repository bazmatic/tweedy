import { logger } from "../utils/logger";
import { IJudgmentLog, JudgmentRecord } from "./JudgmentLog";
import { JudgmentModes, resolveJudgmentMode } from "./judgment-modes";

/** A TypeSafe-backed decision, or the reason it could not be made. */
export type TypeSafeDecision<T> =
  /** `detail` (e.g. raw probabilities) is logged to help inspect disagreements. */
  | { status: "ok"; value: T; detail?: unknown }
  | { status: "unavailable"; reason: string };

export interface JudgmentCall<T> {
  /** Stable judgment name, matched against TYPESAFE_JUDGMENTS. */
  judgment: string;
  /** Today's decision path (LLM call or heuristic). */
  current: () => Promise<T>;
  /** The TypeSafe decision path. Must not be relied on to throw. */
  typesafe: () => Promise<TypeSafeDecision<T>>;
  /** Inputs to record alongside both decisions for later inspection. */
  state?: unknown;
  /** Decides agreement; defaults to deep JSON equality. */
  agrees?: (current: T, typesafe: T) => boolean;
}

/**
 * A decision whose current outcome is only known later — e.g. the tool a
 * model picks while generating a turn — so it cannot be compared up front.
 */
export interface JudgmentPredictionCall<T> {
  judgment: string;
  typesafe: () => Promise<TypeSafeDecision<T>>;
  state?: unknown;
  agrees?: (current: T, typesafe: T) => boolean;
}

export interface JudgmentPrediction<T> {
  /** TypeSafe's decision to act on; set only in "on" mode when available. */
  actOn?: T;
  /** Records what was actually decided, for agreement in shadow mode. */
  settle(outcome: T): Promise<void>;
}

/**
 * Routes one decision point through its configured rollout mode. In shadow
 * mode the acted-on decision is always the current one, and TypeSafe or log
 * failures never propagate — shadowing must not change generation behaviour.
 */
export class JudgmentRunner {
  constructor(
    private readonly modes: JudgmentModes,
    private readonly log: IJudgmentLog
  ) {}

  async run<T>(call: JudgmentCall<T>): Promise<T> {
    const mode = resolveJudgmentMode(this.modes, call.judgment);
    if (mode === "off") return call.current();
    return mode === "shadow" ? this.shadow(call) : this.live(call);
  }

  /**
   * Like run(), for decisions settled later. Shadow mode asks TypeSafe now
   * and compares once settle() reports the outcome; "on" mode returns the
   * decision as actOn, or nothing if TypeSafe is unavailable.
   */
  async predict<T>(call: JudgmentPredictionCall<T>): Promise<JudgmentPrediction<T>> {
    const mode = resolveJudgmentMode(this.modes, call.judgment);
    if (mode === "off") return { settle: async () => {} };

    const decision = await this.safeTypeSafe(call);
    if (mode === "on" && decision.status === "ok") {
      return {
        actOn: decision.value,
        settle: () =>
          this.record(call, { mode: "on", decision, actedOn: "typesafe" }),
      };
    }
    if (mode === "on" && decision.status === "unavailable") {
      logger.warn(
        `TypeSafe judgment "${call.judgment}" unavailable (${decision.reason}); falling back to current behaviour`
      );
    }
    return {
      settle: (outcome) =>
        this.record(call, { mode, current: outcome, decision, actedOn: "current" }),
    };
  }

  private async shadow<T>(call: JudgmentCall<T>): Promise<T> {
    const typesafePromise = this.safeTypeSafe(call);
    const current = await call.current();
    const decision = await typesafePromise;

    await this.record(call, {
      mode: "shadow",
      current,
      decision,
      actedOn: "current",
    });
    return current;
  }

  private async live<T>(call: JudgmentCall<T>): Promise<T> {
    const decision = await this.safeTypeSafe(call);
    if (decision.status === "ok") {
      await this.record(call, { mode: "on", decision, actedOn: "typesafe" });
      return decision.value;
    }

    logger.warn(
      `TypeSafe judgment "${call.judgment}" unavailable (${decision.reason}); falling back to current behaviour`
    );
    const current = await call.current();
    await this.record(call, {
      mode: "on",
      current,
      decision,
      actedOn: "current",
    });
    return current;
  }

  private async safeTypeSafe<T>(
    call: Pick<JudgmentCall<T>, "typesafe">
  ): Promise<TypeSafeDecision<T>> {
    try {
      return await call.typesafe();
    } catch (error) {
      return {
        status: "unavailable",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async record<T>(
    call: Pick<JudgmentCall<T>, "judgment" | "state" | "agrees">,
    outcome: {
      mode: JudgmentRecord["mode"];
      current?: T;
      decision: TypeSafeDecision<T>;
      actedOn: JudgmentRecord["actedOn"];
    }
  ): Promise<void> {
    const hasCurrent = "current" in outcome;
    const typesafe =
      outcome.decision.status === "ok" ? outcome.decision.value : undefined;
    const record: JudgmentRecord = {
      judgment: call.judgment,
      mode: outcome.mode,
      timestamp: new Date().toISOString(),
      state: call.state,
      actedOn: outcome.actedOn,
      ...(hasCurrent ? { current: outcome.current } : {}),
      ...(outcome.decision.status === "ok"
        ? {
            typesafe,
            ...(outcome.decision.detail !== undefined
              ? { typesafeDetail: outcome.decision.detail }
              : {}),
          }
        : { typesafeUnavailableReason: outcome.decision.reason }),
    };
    if (hasCurrent && outcome.decision.status === "ok") {
      const agrees = call.agrees ?? jsonEqual;
      record.agreed = agrees(outcome.current as T, typesafe as T);
    }

    try {
      await this.log.append(record);
    } catch (error) {
      logger.warn(`Failed to log TypeSafe judgment "${call.judgment}":`, error);
    }
  }
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
