import { EditorialCard } from "../types";
import { IJudgmentProvider, score, ScoreQuestion } from "../providers/judgment-questions";
import { JudgmentRunner, TypeSafeDecision } from "../services/JudgmentRunner";
import {
  getJudgmentProvider,
  getJudgmentRunner,
} from "../services/judgment-runtime";

export const CARD_STORY_VALUE_JUDGMENT = "card-story-value";

/** Scores within this distance of the LLM's count as agreeing in shadow mode. */
const AGREEMENT_TOLERANCE = 2;

/**
 * Ordered levels, lowest first, mirroring the preparation prompt's 1-10
 * rubric. Each describes a concrete listening experience.
 */
const STORY_VALUE_LEVELS = [
  "A raw data point: a figure or fact a listener would forget immediately",
  "True but flat: accurate and relevant, but nothing a listener would react to",
  "Engaging: a vivid, surprising, or human detail that holds a listener's attention",
  "A hook worth repeating at a party: striking enough that a listener would retell it",
];

/** Card id → storyValue on the existing 1-10 scale. */
export type StoryValues = Record<string, number>;

export interface StoryValueRequest {
  podcastTitle: string;
  cards: Pick<EditorialCard, "id" | "content">[];
  /** The storyValues the preparation model assigned while extracting. */
  current: () => Promise<StoryValues>;
}

/**
 * Scores each card's story value through the `card-story-value` judgment:
 * one Score per card, separate from (and cheaper to re-run than) the
 * generative card extraction.
 */
export function scoreStoryValues(
  request: StoryValueRequest,
  deps: { runner?: JudgmentRunner; provider?: IJudgmentProvider } = {}
): Promise<StoryValues> {
  const runner = deps.runner ?? getJudgmentRunner();
  return runner.run({
    judgment: CARD_STORY_VALUE_JUDGMENT,
    current: request.current,
    typesafe: () =>
      scoreStoryValuesWithTypeSafe(request, deps.provider ?? getJudgmentProvider()),
    state: { podcastTitle: request.podcastTitle, cards: request.cards.length },
    agrees: (current, typesafe) =>
      Object.keys(typesafe).every(
        (id) =>
          current[id] === undefined ||
          Math.abs(current[id] - typesafe[id]) <= AGREEMENT_TOLERANCE
      ),
  });
}

export async function scoreStoryValuesWithTypeSafe(
  request: StoryValueRequest,
  provider: IJudgmentProvider
): Promise<TypeSafeDecision<StoryValues>> {
  if (request.cards.length === 0) return { status: "ok", value: {} };

  const questions: Record<string, ScoreQuestion> = {};
  request.cards.forEach((_card, index) => {
    questions[`story_value_of_card_${index}`] = score(
      `How surprising, vivid, or emotionally engaging would \`cards[${index}]\` sound spoken aloud to a general ` +
        "listener of this podcast? Judge how it lands as a story, not how factually important it is.",
      STORY_VALUE_LEVELS
    );
  });

  const result = await provider.judge(
    {
      podcast_title: request.podcastTitle,
      cards: request.cards.map((card) => card.content),
    },
    questions
  );
  if (result.status !== "ok") return result;

  const values: StoryValues = {};
  const positions: Record<string, number> = {};
  request.cards.forEach((card, index) => {
    const position = result.answers[`story_value_of_card_${index}`].score;
    positions[card.id] = position;
    values[card.id] = toStoryValue(position);
  });
  return { status: "ok", value: values, detail: { positions } };
}

/** Maps a Score position (0 … levels-1) onto the existing 1-10 scale. */
export function toStoryValue(position: number): number {
  const fraction = position / (STORY_VALUE_LEVELS.length - 1);
  return Math.min(10, Math.max(1, Math.round(1 + fraction * 9)));
}
