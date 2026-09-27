import {
  IJudgmentProvider,
  JudgmentQuestion,
  JudgmentQuestions,
  JudgmentResult,
} from "../providers/judgment-questions";

/** A provider that is always unavailable, so every decision uses its default. */
export function unavailableProvider(): IJudgmentProvider {
  return { judge: async () => ({ status: "unavailable", reason: "no provider in tests" }) };
}

/**
 * A provider whose answers come from `answer(id, question)`. If it returns
 * undefined for any question in a request, the whole request is unavailable.
 */
export function scriptedProvider(
  answer: (id: string, question: JudgmentQuestion) => unknown | undefined
): IJudgmentProvider & { calls: { state: unknown; questions: JudgmentQuestions }[] } {
  const calls: { state: unknown; questions: JudgmentQuestions }[] = [];
  return {
    calls,
    async judge<Q extends JudgmentQuestions>(state: unknown, questions: Q): Promise<JudgmentResult<Q>> {
      calls.push({ state, questions });
      const answers: Record<string, unknown> = {};
      for (const [id, question] of Object.entries(questions)) {
        const value = answer(id, question);
        if (value === undefined) return { status: "unavailable", reason: `unscripted question ${id}` };
        answers[id] = value;
      }
      return { status: "ok", answers } as JudgmentResult<Q>;
    },
  };
}
