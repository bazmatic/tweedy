import { PromptTemplate } from "./types";

export interface DirectorDirectionPromptVars {
  orientationNote: string;
  discourseNote: string;
  fixedSpeakerNote: string;
  pacingSection: string;
}

export const DEFAULT_DIRECTOR_DIRECTION_PROMPT_VARIANT = "default";

export const DIRECTOR_DIRECTION_PROMPT_TEMPLATES: Record<
  string,
  PromptTemplate<DirectorDirectionPromptVars>
> = {
  default: (vars) => `${vars.orientationNote}${vars.discourseNote}${vars.fixedSpeakerNote}

Decide which speaker should talk next.

## Direction Writing
Only give them direction if it's actually needed — a brief goal or topic, not a script. If the conversation is flowing well and the next speaker can naturally carry it forward, leave direction empty rather than inventing something for them to say. When you do give direction, tell them what to address, not what to say; leave the wording, phrasing and specific angle to the speaker so they sound like themselves rather than reciting your lines.

## Turn-Taking & Reply Rules
Don't mistake a brief reaction tag (interject/filler_comment/one_liner/short_question) for a substantive point — if the last speaker only reacted, direct the next speaker to actually answer or continue, not to react to the reaction. A challenge creates a right of reply: direct the speaker who was challenged to respond before the challenger speaks again. A good challenge can open a short segment: after the challenged speaker's first answer, it is fine to let the exchange continue for another turn or two until the objection is genuinely resolved, rather than moving straight to a new point. Respect the chronological order shown above; a remark made before a challenge cannot be described as a response to that challenge.

## Avoiding Repetition
Before assigning a goal or direction, check the conversation so far for any fact, comparison, analogy, illustrative example, or question already used — even if worded differently than you'd phrase it — and never direct a speaker to re-explain, re-derive, or re-ask about it; point them toward new ground instead. This applies just as much to a brief handoff (invite, short_question) as to a full explanation: don't reach for an already-settled topic just because the move calls for something short. If the open discussion points list above shows points already addressed by recent turns, mark their ids in coveredPointIds — only mark a point covered if it was explicitly and substantively discussed with specific detail from the point's text, not merely a topically-adjacent mention (e.g. mentioning an oxygen tank explosion does NOT cover a point about a CO2 scrubber duct-tape hack).

## Editorial Fields
Also choose a subject-neutral editorial move, the primary audience value, desired energy, relevant beat and prepared card ids. Every turn should help the listener understand, entertain them, reveal something meaningful, create connection, or move the conversation forwards; it need not do all of these. Don't force analysis onto a story or humour onto an explanation. Choose the beat this proposed turn should advance; beat completion is recorded only after the resulting speech is accepted and reviewed.

## Fixed Exclusions
The episode's welcome and speaker introductions are already handled before you are ever consulted — never direct anyone to (re)welcome listeners or (re)introduce themselves or a co-host, no matter how far into the episode this is.

Use Australian/British spelling.

## Pacing & Rhythm${vars.pacingSection}

## Device Assignment
Occasionally — at most once every several turns, mid-explanation — assign the trail_off device so a speaker hands an unfinished sentence to their co-host to complete; never assign it on a closing or summary turn. When a speaker is about to open a brand new beat or point the conversation hasn't touched yet, consider assigning them the tease move instead of explain — a short hook rather than the full explanation — so their co-host can naturally invite them to continue; don't use tease for a beat that's already underway.`,
};

export function resolveDirectorDirectionPromptTemplate(
  variantId: string | undefined
): PromptTemplate<DirectorDirectionPromptVars> {
  return (
    DIRECTOR_DIRECTION_PROMPT_TEMPLATES[
      variantId ?? DEFAULT_DIRECTOR_DIRECTION_PROMPT_VARIANT
    ] ?? DIRECTOR_DIRECTION_PROMPT_TEMPLATES[DEFAULT_DIRECTOR_DIRECTION_PROMPT_VARIANT]
  );
}
