import { describe, expect, it, vi } from "vitest";
import {
  AudienceProfile,
  AudienceValue,
  EditorialMove,
  EnergyLevel,
  Speech,
  VocalProviderName,
} from "../types";
import { TurnReviewerAgent } from "./TurnReviewerAgent";
import { ModelTask } from "../providers/ModelRoutingPolicy";
import { SpeakerAgentToolName } from "./speaker-tools";

const speaker = {
  id: "s1",
  slug: "s1",
  name: "Ada",
  personality: "warm",
  voice: {
    id: "v1",
    name: "Voice",
    description: "",
    provider: VocalProviderName.ElevenLabs,
    providerId: "voice",
    settings: {},
  },
  voiceStyle: "natural",
};

const speech: Speech = {
  id: "sp1",
  speaker,
  message: "I kept thinking about that letter above her desk.",
  instructions: "reflective",
  voice: speaker.voice,
  voiceStyle: speaker.voiceStyle,
  timestamp: new Date(),
};

describe("TurnReviewerAgent", () => {
  it("reviews according to the assigned editorial purpose", async () => {
    const agent = new TurnReviewerAgent();
    const call = vi
      .spyOn(agent as any, "callModelForStructuredOutput")
      .mockResolvedValue({
        accepted: true,
        clear: true,
        engaging: true,
        grounded: true,
        advancesBeat: true,
        addsVariety: true,
        roleConsistent: true,
        knowledgeConsistent: true,
        audienceAccessible: true,
        castConsistent: true,
        introducedCardIds: [],
        introducedTerms: [],
        feedback: [],
        revisedMessages: [],
      });

    const result = await agent.review(
      speech,
      {
        speakerId: "s1",
        goal: "Humanise the subject through one telling detail.",
        move: EditorialMove.Humanise,
        cardIds: [],
        audienceValue: AudienceValue.Connection,
        desiredEnergy: EnergyLevel.Reflective,
      },
      [],
      []
    );

    expect(call.mock.calls[0][0]).toBe(ModelTask.TurnReview);
    const prompt = (call.mock.calls[0][1] as any)[0].content as string;
    expect(prompt).toContain("Humanise the subject");
    expect(prompt).toContain("Do not demand analysis from a story");
    expect(prompt).toContain("First perform a listener-comprehension audit");
    expect(prompt).toContain(
      "You cannot see the director's goal, prepared cards, source notes, or future turns"
    );
    expect(prompt).toContain(
      "set clear, audienceAccessible, and accepted to false"
    );
    expect(prompt).toContain(
      "should normally acknowledge the co-host's contribution"
    );
    expect(prompt).toContain("simply talks past the interjection");
    expect(prompt).toContain("This call judges only");
    expect(prompt).toContain("at most 12 words");
    expect(prompt).toContain("proposed candidate that has NOT been heard");
    expect(prompt).toContain("Speaker epistemic role: audience_guide");
    expect(prompt).toContain("Natural fillers, pauses, hesitations");
    expect(prompt).toContain('phrases such as "where we left off"');
    expect(prompt).toContain("uninterrupted adjacent exchange");
    expect(prompt).toContain("Audience profile: general");
    expect(prompt).toContain("likely unfamiliar to this audience");
    expect(prompt).toContain(
      '"the other Cyclopes" introduces a group, while "the others" does not'
    );
    expect(result.accepted).toBe(true);
    expect(result.feedback).toBe("");
    expect(result.revisedMessage).toBe("");
  });

  it("adds the closing-statement guardrail note only for CLOSING_STATEMENT turns", async () => {
    const agent = new TurnReviewerAgent();
    const call = vi
      .spyOn(agent as any, "callModelForStructuredOutput")
      .mockResolvedValue({
        accepted: true,
        clear: true,
        engaging: true,
        grounded: true,
        advancesBeat: true,
        addsVariety: true,
        roleConsistent: true,
        knowledgeConsistent: true,
        audienceAccessible: true,
        castConsistent: true,
        introducedCardIds: [],
        introducedTerms: [],
        feedback: [],
        revisedMessages: [],
      });

    await agent.review(
      { ...speech, tool: SpeakerAgentToolName.CLOSING_STATEMENT },
      {
        speakerId: "s1",
        goal: "Wrap up the episode.",
        move: EditorialMove.Summarise,
        cardIds: [],
        audienceValue: AudienceValue.Connection,
        desiredEnergy: EnergyLevel.Reflective,
      },
      [],
      []
    );

    const prompt = (call.mock.calls[0][1] as any)[0].content as string;
    expect(prompt).toContain("must not introduce any new topic");
    expect(prompt).toContain("must not end on a question mark");
    expect(prompt).not.toContain("nearly out of time");
  });

  it("omits the subject-identification and reference rules from a cold open's prompt entirely, rather than overriding them", async () => {
    const agent = new TurnReviewerAgent();
    const call = vi
      .spyOn(agent as any, "callModelForStructuredOutput")
      .mockResolvedValue({
        accepted: true,
        clear: true,
        engaging: true,
        grounded: true,
        advancesBeat: true,
        addsVariety: true,
        roleConsistent: true,
        knowledgeConsistent: true,
        audienceAccessible: true,
        castConsistent: true,
        introducedCardIds: [],
        introducedTerms: [],
        feedback: [],
        revisedMessages: [],
      });

    await agent.review(
      { ...speech, tool: SpeakerAgentToolName.COLD_OPEN },
      {
        speakerId: "s1",
        goal: "Open cold with a vivid tease.",
        move: EditorialMove.Humanise,
        cardIds: [],
        audienceValue: AudienceValue.Connection,
        desiredEnergy: EnergyLevel.Warm,
      },
      [],
      []
    );

    const prompt = (call.mock.calls[0][1] as any)[0].content as string;
    // The rules themselves must not appear at all — not appear-then-be-
    // overridden by a countermanding note.
    expect(prompt).not.toContain("resolve every necessary reference");
    expect(prompt).not.toContain("paraphrase the turn's complete point");
    expect(prompt).not.toContain(
      "Reject and revise a turn when a definite reference or pronoun requires an unheard person"
    );
    expect(prompt).toContain("This is the cold open");
    expect(prompt).toContain(
      "do not require the subject, a pronoun, or a named person or place to already be identified"
    );
  });

  it("does not exempt an ordinary turn from the comprehension audit", async () => {
    const agent = new TurnReviewerAgent();
    const call = vi
      .spyOn(agent as any, "callModelForStructuredOutput")
      .mockResolvedValue({
        accepted: true,
        clear: true,
        engaging: true,
        grounded: true,
        advancesBeat: true,
        addsVariety: true,
        roleConsistent: true,
        knowledgeConsistent: true,
        audienceAccessible: true,
        castConsistent: true,
        introducedCardIds: [],
        introducedTerms: [],
        feedback: [],
        revisedMessages: [],
      });

    await agent.review(
      speech,
      {
        speakerId: "s1",
        goal: "Explain the point.",
        move: EditorialMove.Explain,
        cardIds: [],
        audienceValue: AudienceValue.Understanding,
        desiredEnergy: EnergyLevel.Curious,
      },
      [],
      []
    );

    const prompt = (call.mock.calls[0][1] as any)[0].content as string;
    expect(prompt).toContain("resolve every necessary reference");
    expect(prompt).toContain(
      "Reject and revise a turn when a definite reference or pronoun requires an unheard person"
    );
    expect(prompt).not.toContain("This is the cold open");
  });

  it("does not require a question-move turn to also explain the term it's asking about", async () => {
    const agent = new TurnReviewerAgent();
    const call = vi
      .spyOn(agent as any, "callModelForStructuredOutput")
      .mockResolvedValue({
        accepted: true,
        clear: true,
        engaging: true,
        grounded: true,
        advancesBeat: true,
        addsVariety: true,
        roleConsistent: true,
        knowledgeConsistent: true,
        audienceAccessible: true,
        castConsistent: true,
        introducedCardIds: [],
        introducedTerms: [],
        feedback: [],
        revisedMessages: [],
      });

    await agent.review(
      { ...speech, message: 'Claire, what does "metis" actually mean?' },
      {
        speakerId: "s1",
        goal: 'Ask for a plain-language explanation of "metis".',
        move: EditorialMove.Question,
        cardIds: [],
        audienceValue: AudienceValue.Understanding,
        desiredEnergy: EnergyLevel.Curious,
      },
      [],
      []
    );

    const prompt = (call.mock.calls[0][1] as any)[0].content as string;
    expect(prompt).not.toContain(
      "When a specialist concept carries the argument, reject unless its meaning is explained plainly"
    );
    expect(prompt).toContain(
      "a turn whose job is to ask about the concept (this one) is not expected to explain it"
    );
  });

  it("also exempts a question posed under a different editorial move, detected from the wording itself", async () => {
    const agent = new TurnReviewerAgent();
    const call = vi
      .spyOn(agent as any, "callModelForStructuredOutput")
      .mockResolvedValue({
        accepted: true,
        clear: true,
        engaging: true,
        grounded: true,
        advancesBeat: true,
        addsVariety: true,
        roleConsistent: true,
        knowledgeConsistent: true,
        audienceAccessible: true,
        castConsistent: true,
        introducedCardIds: [],
        introducedTerms: [],
        feedback: [],
        revisedMessages: [],
      });

    await agent.review(
      {
        ...speech,
        // Question mark appears mid-turn, not at the end — the check must
        // not require the turn to end on it.
        message: 'What is "metis"? I honestly have no idea.',
      },
      {
        speakerId: "s1",
        goal: "React with genuine curiosity.",
        move: EditorialMove.React,
        cardIds: [],
        audienceValue: AudienceValue.Connection,
        desiredEnergy: EnergyLevel.Curious,
      },
      [],
      []
    );

    const prompt = (call.mock.calls[0][1] as any)[0].content as string;
    expect(prompt).toContain(
      "a turn whose job is to ask about the concept (this one) is not expected to explain it"
    );
  });

  it("adds the nearly-out-of-time guardrail note only for NEARLY_OUT_OF_TIME turns", async () => {
    const agent = new TurnReviewerAgent();
    const call = vi
      .spyOn(agent as any, "callModelForStructuredOutput")
      .mockResolvedValue({
        accepted: true,
        clear: true,
        engaging: true,
        grounded: true,
        advancesBeat: true,
        addsVariety: true,
        roleConsistent: true,
        knowledgeConsistent: true,
        audienceAccessible: true,
        castConsistent: true,
        introducedCardIds: [],
        introducedTerms: [],
        feedback: [],
        revisedMessages: [],
      });

    await agent.review(
      { ...speech, tool: SpeakerAgentToolName.NEARLY_OUT_OF_TIME },
      {
        speakerId: "s1",
        goal: "Flag time pressure.",
        move: EditorialMove.Transition,
        cardIds: [],
        audienceValue: AudienceValue.Connection,
        desiredEnergy: EnergyLevel.Reflective,
      },
      [],
      []
    );

    const prompt = (call.mock.calls[0][1] as any)[0].content as string;
    expect(prompt).toContain("must actually answer it in substance");
    expect(prompt).not.toContain("episode's closing statement");
  });

  it("cannot accept a turn that violates role consistency", async () => {
    const agent = new TurnReviewerAgent();
    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValue({
      accepted: true,
      clear: true,
      engaging: true,
      grounded: true,
      advancesBeat: true,
      addsVariety: true,
      roleConsistent: false,
      knowledgeConsistent: true,
      audienceAccessible: true,
      introducedCardIds: [],
      introducedTerms: [],
    });

    const result = await agent.review(
      speech,
      {
        speakerId: "s1",
        goal: "Ask for clarification.",
        move: EditorialMove.Question,
        cardIds: [],
        audienceValue: AudienceValue.Understanding,
        desiredEnergy: EnergyLevel.Curious,
      },
      [],
      []
    );

    expect(result.accepted).toBe(false);
  });

  it("cannot accept necessary jargon that is inaccessible to the audience", async () => {
    const agent = new TurnReviewerAgent();
    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValue({
      accepted: true,
      clear: true,
      engaging: true,
      grounded: true,
      advancesBeat: true,
      addsVariety: true,
      roleConsistent: true,
      knowledgeConsistent: true,
      audienceAccessible: false,
      introducedCardIds: [],
      introducedTerms: [],
    });

    const result = await agent.review(
      { ...speech, message: "The Shannon entropy is similar." },
      {
        speakerId: "s1",
        goal: "Explain what the measurement means.",
        move: EditorialMove.Explain,
        cardIds: [],
        audienceValue: AudienceValue.Understanding,
        desiredEnergy: EnergyLevel.Curious,
      },
      [],
      [],
      undefined,
      AudienceProfile.General
    );

    expect(result.accepted).toBe(false);
  });

  it("separates a rejected verdict from its small rewrite call", async () => {
    const agent = new TurnReviewerAgent();
    const call = vi
      .spyOn(agent as any, "callModelForStructuredOutput")
      .mockResolvedValueOnce({
        accepted: false,
        clear: false,
        engaging: true,
        grounded: true,
        advancesBeat: true,
        addsVariety: true,
        roleConsistent: true,
        knowledgeConsistent: true,
        audienceAccessible: false,
        castConsistent: true,
        introducedCardIds: [],
        introducedTerms: [],
        feedback: ["Missing listener context"],
      })
      .mockResolvedValueOnce({ message: "A clearer version." });

    const result = await agent.review(
      speech,
      {
        speakerId: "s1",
        goal: "Make the point clearly.",
        move: EditorialMove.Explain,
        cardIds: [],
        audienceValue: AudienceValue.Understanding,
        desiredEnergy: EnergyLevel.Curious,
      },
      [],
      []
    );

    expect(result.accepted).toBe(false);
    expect(result.feedback).toBe("Missing listener context");
    expect(result.revisedMessage).toBe("A clearer version.");
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[1][2]).toHaveProperty("shape");
    expect((call.mock.calls[1][1] as any)[0].content).toContain(
      "Return only one complete corrected spoken turn"
    );
    expect((call.mock.calls[1][1] as any)[0].content).toContain(
      "Relevant prepared material"
    );
  });

  it("tells the reviewer what problem a revision is meant to fix, when reviewing a revision", async () => {
    const agent = new TurnReviewerAgent();
    const call = vi
      .spyOn(agent as any, "callModelForStructuredOutput")
      .mockResolvedValue({
        accepted: true,
        clear: true,
        engaging: true,
        grounded: true,
        advancesBeat: true,
        addsVariety: true,
        roleConsistent: true,
        knowledgeConsistent: true,
        audienceAccessible: true,
        castConsistent: true,
        introducedCardIds: [],
        introducedTerms: [],
        feedback: [],
      });

    await agent.review(
      speech,
      {
        speakerId: "s1",
        goal: "Make the point clearly.",
        move: EditorialMove.Explain,
        cardIds: [],
        audienceValue: AudienceValue.Understanding,
        desiredEnergy: EnergyLevel.Curious,
      },
      [],
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      "Missing listener context"
    );

    const prompt = (call.mock.calls[0][1] as any)[0].content as string;
    expect(prompt).toContain(
      'This is a corrected rewrite of an earlier candidate that you rejected for: "Missing listener context"'
    );
    expect(prompt).toContain("do not reject the turn again for a different, marginal reading");
  });

  it("omits the revision-context note on a first-pass review", async () => {
    const agent = new TurnReviewerAgent();
    const call = vi
      .spyOn(agent as any, "callModelForStructuredOutput")
      .mockResolvedValue({
        accepted: true,
        clear: true,
        engaging: true,
        grounded: true,
        advancesBeat: true,
        addsVariety: true,
        roleConsistent: true,
        knowledgeConsistent: true,
        audienceAccessible: true,
        castConsistent: true,
        introducedCardIds: [],
        introducedTerms: [],
        feedback: [],
      });

    await agent.review(
      speech,
      {
        speakerId: "s1",
        goal: "Make the point clearly.",
        move: EditorialMove.Explain,
        cardIds: [],
        audienceValue: AudienceValue.Understanding,
        desiredEnergy: EnergyLevel.Curious,
      },
      [],
      []
    );

    const prompt = (call.mock.calls[0][1] as any)[0].content as string;
    expect(prompt).not.toContain("corrected rewrite of an earlier candidate");
  });

  it("preserves a valid rejection when the rewrite call fails", async () => {
    const agent = new TurnReviewerAgent();
    vi.spyOn(agent as any, "callModelForStructuredOutput")
      .mockResolvedValueOnce({
        accepted: false,
        clear: false,
        engaging: true,
        grounded: true,
        advancesBeat: true,
        addsVariety: true,
        roleConsistent: true,
        knowledgeConsistent: true,
        audienceAccessible: false,
        castConsistent: true,
        introducedCardIds: [],
        introducedTerms: [],
        feedback: ["Missing listener context"],
      })
      .mockRejectedValueOnce(new Error("malformed rewrite"));

    const result = await agent.review(
      speech,
      {
        speakerId: "s1",
        goal: "Make the point clearly.",
        move: EditorialMove.Explain,
        cardIds: [],
        audienceValue: AudienceValue.Understanding,
        desiredEnergy: EnergyLevel.Curious,
      },
      [],
      []
    );

    expect(result.accepted).toBe(false);
    expect(result.feedback).toBe("Missing listener context");
    expect(result.revisedMessage).toBe("");
  });

  it("passes the real speaker roster to the reviewer and rejects a cast-inconsistent turn", async () => {
    const agent = new TurnReviewerAgent();
    const call = vi
      .spyOn(agent as any, "callModelForStructuredOutput")
      .mockResolvedValue({
        accepted: true,
        clear: true,
        engaging: true,
        grounded: true,
        advancesBeat: true,
        addsVariety: true,
        roleConsistent: true,
        knowledgeConsistent: true,
        audienceAccessible: true,
        castConsistent: false,
        introducedCardIds: [],
        introducedTerms: [],
      });

    const result = await agent.review(
      { ...speech, message: "Karina, set that up for our listeners." },
      {
        speakerId: "s1",
        goal: "Hand off to a co-host.",
        move: EditorialMove.Transition,
        cardIds: [],
        audienceValue: AudienceValue.Understanding,
        desiredEnergy: EnergyLevel.Curious,
      },
      [],
      [],
      undefined,
      AudienceProfile.General,
      undefined,
      [speaker, { ...speaker, id: "s2", name: "Miles" }]
    );

    const prompt = (call.mock.calls[0][1] as any)[0].content as string;
    expect(prompt).toContain("This episode's actual speakers: Ada, Miles");
    expect(result.accepted).toBe(false);
  });

  it("checks repetition against everything said so far by any speaker, not just this speaker's own recent lines", async () => {
    const agent = new TurnReviewerAgent();
    const call = vi
      .spyOn(agent as any, "callModelForStructuredOutput")
      .mockResolvedValue({
        accepted: true,
        clear: true,
        engaging: true,
        grounded: true,
        advancesBeat: true,
        addsVariety: true,
        roleConsistent: true,
        knowledgeConsistent: true,
        audienceAccessible: true,
        castConsistent: true,
        introducedCardIds: [],
        introducedTerms: [],
      });

    const coHost = { ...speaker, id: "s2", name: "Miles" };
    const recentSpeeches: Speech[] = Array.from({ length: 8 }, (_, i) => ({
      id: `sp-${i}`,
      speaker: i === 0 ? coHost : speaker,
      message:
        i === 0
          ? "The letter above her desk was actually a forgery."
          : `filler turn ${i}`,
      instructions: "",
      voice: speaker.voice,
      voiceStyle: speaker.voiceStyle,
      timestamp: new Date(),
    }));

    await agent.review(
      speech,
      {
        speakerId: "s1",
        goal: "Reveal the forgery.",
        move: EditorialMove.TellStory,
        cardIds: [],
        audienceValue: AudienceValue.Connection,
        desiredEnergy: EnergyLevel.Reflective,
      },
      [],
      recentSpeeches
    );

    const prompt = (call.mock.calls[0][1] as any)[0].content as string;
    expect(prompt).toContain(
      "What has already been said in the episode so far, by any speaker"
    );
    // The co-host's line from 7 turns back must still be visible, not just
    // this speaker's (Ada's) own recent lines.
    expect(prompt).toContain("Miles: The letter above her desk was actually a forgery.");
  });
});
