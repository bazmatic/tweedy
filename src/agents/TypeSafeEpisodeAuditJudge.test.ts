import { describe, expect, it, vi } from "vitest";
import {
  auditEpisodeTurns,
  auditEpisodeTurnsWithTypeSafe,
} from "./TypeSafeEpisodeAuditJudge";
import { IJudgmentProvider, JudgmentQuestions } from "../providers/judgment-questions";
import { setJudgmentProvider } from "../services/judgment-runtime";
import { unavailableProvider } from "../test-support/judgments";
import { Speech } from "../types";

const said = (id: string, message: string) =>
  ({ id, speaker: { name: id.startsWith("a") ? "Ada" : "Ben" }, message }) as unknown as Speech;

const speeches = [said("a1", "Welcome."), said("b1", "Hi."), said("a2", "And that saved them."), said("b2", "Goodbye.")];

/**
 * Answers turn i's Choice with choices[i] (default no_local_defect), and a
 * `no_local_defect` probability of noDefectProbability[i] (default 0.9 for a
 * clean turn, 0.2 for a chosen defect — i.e. flagged unless overridden).
 */
function defects(choices: Record<number, string>, noDefectProbability: Record<number, number> = {}) {
  const judge = vi.fn(async (_state: unknown, questions: JudgmentQuestions) => ({
    status: "ok" as const,
    answers: Object.fromEntries(
      Object.keys(questions).map((id) => {
        const index = Number(id.split("_").at(-1));
        const option = choices[index] ?? "no_local_defect";
        const p = noDefectProbability[index] ?? (option === "no_local_defect" ? 0.9 : 0.2);
        return [
          id,
          { type: "choice", choice: option, probabilities: { no_local_defect: p }, confidence: 1 - p },
        ];
      })
    ),
  }));
  return { judge } as unknown as IJudgmentProvider & { judge: typeof judge };
}

const request = { speeches, maxIssues: 3 };

describe("auditEpisodeTurnsWithTypeSafe", () => {
  it("asks one Choice per turn, with the closing option only on the final turn", async () => {
    const provider = defects({});

    await auditEpisodeTurnsWithTypeSafe(request, provider, 0.5);

    const [state, questions] = provider.judge.mock.calls[0];
    expect((state as any).transcript[2]).toEqual({ speaker: "Ada", text: "And that saved them." });
    expect(Object.keys(questions)).toEqual([
      "most_serious_defect_in_turn_0",
      "most_serious_defect_in_turn_1",
      "most_serious_defect_in_turn_2",
      "most_serious_defect_in_turn_3",
    ]);
    const options = (index: number) => Object.keys((questions as any)[`most_serious_defect_in_turn_${index}`].criteria);
    expect(options(0)).not.toContain("closing_misstates_the_episode");
    expect(options(3)).toContain("closing_misstates_the_episode");
    expect(options(0)).toContain("no_local_defect");
  });

  it("maps flagged turns to audit issues, most confident first, capped", async () => {
    const decision = await auditEpisodeTurnsWithTypeSafe(
      { ...request, maxIssues: 2 },
      defects(
        { 1: "repeats_earlier_content", 2: "consequence_before_its_setup", 3: "closing_misstates_the_episode" },
        { 1: 0.4, 2: 0.05, 3: 0.2 }
      ),
      0.5
    );

    expect(decision).toMatchObject({
      status: "ok",
      value: [
        { speechId: "a2", category: "dependency_order", reason: "States a consequence before its setup" },
        { speechId: "b2", category: "closing_accuracy" },
      ],
    });
  });

  it("ignores a defect whose no_local_defect probability is at or above the threshold", async () => {
    const decision = await auditEpisodeTurnsWithTypeSafe(
      request,
      defects({ 2: "repeats_earlier_content" }, { 2: 0.6 }),
      0.5
    );

    expect(decision).toMatchObject({ status: "ok", value: [] });
  });
});

describe("auditEpisodeTurns", () => {
  it("returns the judged issues", async () => {
    const provider = defects({ 2: "consequence_before_its_setup" });

    const issues = await auditEpisodeTurns(request, { provider });

    expect(issues.map((issue) => issue.speechId)).toEqual(["a2"]);
  });

  it("falls back to no issues when the provider is unavailable", async () => {
    setJudgmentProvider(unavailableProvider());

    expect(await auditEpisodeTurns(request)).toEqual([]);
  });
});
