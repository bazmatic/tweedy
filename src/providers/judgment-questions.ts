// Typed question builders and answer shapes for TypeSafe System One judgments.
// A question set is a record keyed by question id; the answers a provider
// returns are inferred from it, so `answers.covered.probability` type-checks
// only when `covered` was asked as a noul().

export interface ChoiceQuestion<K extends string = string> {
  type: "choice";
  instructions: string;
  criteria: Record<K, string | null>;
}

export interface NoulQuestion {
  type: "noul";
  instructions: string;
  criteria?: { true: string; false: string };
}

export interface ScoreQuestion {
  type: "score";
  instructions: string;
  criteria: string[];
}

export type JudgmentQuestion = ChoiceQuestion | NoulQuestion | ScoreQuestion;
export type JudgmentQuestions = Record<string, JudgmentQuestion>;

export interface ChoiceAnswer<K extends string = string> {
  type: "choice";
  choice: K;
  probabilities: Record<K, number>;
  confidence: number;
}

export interface NoulAnswer {
  type: "noul";
  /** Probability that the condition holds (0-1). */
  probability: number;
}

export interface ScoreAnswer {
  type: "score";
  /** Probability-weighted position on the ordered criteria levels. */
  score: number;
  confidence: number;
}

// Distributes over a union of question types, so a generic question record
// yields a union of answers rather than collapsing to one branch.
export type JudgmentAnswer<Q> = Q extends ChoiceQuestion<infer K>
  ? ChoiceAnswer<K>
  : Q extends NoulQuestion
    ? NoulAnswer
    : Q extends ScoreQuestion
      ? ScoreAnswer
      : never;

export type JudgmentAnswers<Q extends JudgmentQuestions> = {
  [Id in keyof Q]: JudgmentAnswer<Q[Id]>;
};

export type JudgmentResult<Q extends JudgmentQuestions> =
  | { status: "ok"; answers: JudgmentAnswers<Q> }
  /** The judgment could not be obtained; callers fall back to current behaviour. */
  | { status: "unavailable"; reason: string };

export interface IJudgmentProvider {
  judge<Q extends JudgmentQuestions>(
    state: unknown,
    questions: Q
  ): Promise<JudgmentResult<Q>>;
}

export function choice<K extends string>(
  instructions: string,
  criteria: Record<K, string | null>
): ChoiceQuestion<K> {
  return { type: "choice", instructions, criteria };
}

export function noul(
  instructions: string,
  criteria?: { true: string; false: string }
): NoulQuestion {
  return { type: "noul", instructions, ...(criteria ? { criteria } : {}) };
}

export function score(instructions: string, criteria: string[]): ScoreQuestion {
  return { type: "score", instructions, criteria };
}
