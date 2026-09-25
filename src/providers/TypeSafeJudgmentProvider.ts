import axios from "axios";
import { logger } from "../utils/logger";
import {
  IJudgmentProvider,
  JudgmentAnswers,
  JudgmentQuestions,
  JudgmentResult,
} from "./judgment-questions";

const TYPESAFE_API_URL = "https://api.typesafe.ai/v1/systemone";
const DEFAULT_MODEL = "jev-latest";
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_RETRY_DELAY_MS = 250;

// 429 (rate limit) and 529 (overloaded) are documented as retry-after-a-short-delay.
const RETRYABLE_STATUSES = new Set([429, 529]);

export interface TypeSafeJudgmentOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

interface RawAnswer {
  type?: string;
  noul?: number;
  choice?: string;
  probabilities?: Record<string, number>;
  confidence?: number;
  score?: number;
}

/**
 * Asks TypeSafe System One (Jev) a set of typed questions over one state.
 * Questions in a single call run in parallel server-side. Any failure —
 * missing key, timeout, HTTP error, malformed answer — yields an
 * `unavailable` result rather than throwing, so callers can fall back to
 * their existing behaviour.
 */
export class TypeSafeJudgmentProvider implements IJudgmentProvider {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(options: TypeSafeJudgmentOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY;
    this.baseUrl = options.baseUrl ?? TYPESAFE_API_URL;
    this.model = options.model ?? DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  get isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async judge<Q extends JudgmentQuestions>(
    state: unknown,
    questions: Q
  ): Promise<JudgmentResult<Q>> {
    if (!this.apiKey) {
      return unavailable("TYPESAFE_API_KEY environment variable is not set");
    }

    const body = { state, model: this.model, questions };
    let lastReason = "unknown error";

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        await sleep(this.retryDelayMs * attempt);
      }
      try {
        const response = await axios.post(this.baseUrl, body, {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          timeout: this.timeoutMs,
        });
        return this.parseAnswers(questions, response.data?.answers);
      } catch (error) {
        const status = axios.isAxiosError(error)
          ? error.response?.status
          : undefined;
        lastReason = describeError(error, status);
        const retryable =
          status === undefined
            ? axios.isAxiosError(error) // network error or timeout
            : RETRYABLE_STATUSES.has(status);
        if (!retryable) break;
      }
    }

    return unavailable(lastReason);
  }

  private parseAnswers<Q extends JudgmentQuestions>(
    questions: Q,
    raw: Record<string, RawAnswer> | undefined
  ): JudgmentResult<Q> {
    if (!raw || typeof raw !== "object") {
      return unavailable("response contained no answers");
    }

    const answers: Record<string, unknown> = {};
    for (const [id, question] of Object.entries(questions)) {
      const answer = raw[id];
      if (!answer) {
        return unavailable(`response is missing an answer for "${id}"`);
      }
      switch (question.type) {
        case "choice": {
          const chosen = answer.choice;
          if (
            typeof chosen !== "string" ||
            !(chosen in question.criteria) ||
            typeof answer.confidence !== "number"
          ) {
            return unavailable(`malformed choice answer for "${id}"`);
          }
          answers[id] = {
            type: "choice",
            choice: chosen,
            probabilities: answer.probabilities ?? {},
            confidence: answer.confidence,
          };
          break;
        }
        case "noul": {
          if (typeof answer.noul !== "number") {
            return unavailable(`malformed noul answer for "${id}"`);
          }
          answers[id] = { type: "noul", probability: answer.noul };
          break;
        }
        case "score": {
          if (
            typeof answer.score !== "number" ||
            typeof answer.confidence !== "number"
          ) {
            return unavailable(`malformed score answer for "${id}"`);
          }
          answers[id] = {
            type: "score",
            score: answer.score,
            confidence: answer.confidence,
          };
          break;
        }
      }
    }

    return { status: "ok", answers: answers as JudgmentAnswers<Q> };
  }
}

function unavailable<Q extends JudgmentQuestions>(
  reason: string
): JudgmentResult<Q> {
  logger.warn(`TypeSafe judgment unavailable: ${reason}`);
  return { status: "unavailable", reason };
}

function describeError(error: unknown, status: number | undefined): string {
  if (status !== undefined) return `HTTP ${status}`;
  if (axios.isAxiosError(error)) {
    return error.code === "ECONNABORTED" ? "request timed out" : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}
