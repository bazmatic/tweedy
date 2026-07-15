import { PodcastScript } from "../types";

/** How many recent speeches the SpeakerAgent already sees verbatim. */
const RECENT_WINDOW = 10;

/**
 * Builds a compact "earlier in the episode" recap from discussion points
 * covered before the recent conversation window, so speakers can make
 * long-range callbacks without an extra model call.
 */
export class EpisodeRecapPolicy {
  buildRecap(script: PodcastScript): string {
    const windowStartTurn = Math.max(
      0,
      script.speeches.length - RECENT_WINDOW
    );
    const earlierPoints = (script.discussionPoints ?? []).filter(
      (point) =>
        point.covered &&
        point.coveredAtTurn !== undefined &&
        point.coveredAtTurn <= windowStartTurn
    );
    if (earlierPoints.length === 0) return "";
    return `Earlier in the episode (before the recent conversation shown below) you already discussed: ${earlierPoints
      .map((point) => point.text)
      .join("; ")}. You may briefly call back to these ("as we said earlier…") but never re-explain them.`;
  }
}
