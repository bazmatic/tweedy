import { IJudgmentProvider, noul } from "../providers/judgment-questions";
import { decide, JudgmentDecision } from "../services/decide";
import { getJudgmentProvider } from "../services/judgment-runtime";

export const CONVERSATION_COMPLETE_JUDGMENT = "conversation-complete";

/**
 * Minimum probability that the episode has naturally wrapped up. The
 * structural gates (all points covered, a real sign-off) have already passed
 * by the time this is asked, so an even split is a reasonable default.
 */
export const DEFAULT_CONCLUSION_THRESHOLD = 0.5;

export interface ConclusionRequest {
  /** Accepted conversation transcript so far. */
  transcript: string;
}

export interface ConclusionJudgeDeps {
  provider?: IJudgmentProvider;
  threshold?: number;
}

const QUESTION = noul(
  "All discussion points for this podcast episode have been covered and the final turn is a sign-off. " +
    "Has the conversation in `transcript` reached a natural, satisfying conclusion — farewells exchanged, " +
    "an explicit sense of wrap-up or closure — rather than merely having covered its required points while " +
    "still feeling mid-thought or open-ended?",
  {
    true: "The episode has genuinely wrapped up naturally",
    false: "The discussion still feels mid-thought, open-ended, or cut off",
  }
);

/**
 * Decides whether the episode has naturally concluded through the
 * `conversation-complete` judgment. Fails safe to false: an unavailable
 * provider means production continues rather than ending prematurely.
 */
export function verifyConversationComplete(
  request: ConclusionRequest,
  deps: ConclusionJudgeDeps = {}
): Promise<boolean> {
  return decide({
    judgment: CONVERSATION_COMPLETE_JUDGMENT,
    ask: () =>
      judgeConversationCompleteWithTypeSafe(
        request.transcript,
        deps.provider ?? getJudgmentProvider(),
        deps.threshold ?? DEFAULT_CONCLUSION_THRESHOLD
      ),
    fallback: false,
    state: { transcriptTail: tail(request.transcript, 600) },
  });
}

export async function judgeConversationCompleteWithTypeSafe(
  transcript: string,
  provider: IJudgmentProvider,
  threshold: number
): Promise<JudgmentDecision<boolean>> {
  const result = await provider.judge(
    { transcript: transcript || "(nothing said yet)" },
    { complete: QUESTION }
  );
  if (result.status !== "ok") return result;

  const probability = result.answers.complete.probability;
  return {
    status: "ok",
    value: probability >= threshold,
    detail: { probability },
  };
}

// The log only needs the ending to explain a disagreement.
function tail(text: string, length: number): string {
  return text.length > length ? "…" + text.slice(-length) : text;
}
