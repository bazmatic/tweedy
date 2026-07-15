import { describe, expect, it } from "vitest";
import {
  EditorialCard,
  EditorialCardKind,
  KnowledgeSource,
  PodcastScript,
  Speaker,
  Speech,
  VocalProviderName,
} from "../types";
import { OpeningSequencePolicy, OpeningStage } from "./OpeningSequencePolicy";

function makeSpeaker(id: string, isExpert: boolean): Speaker {
  return {
    id,
    slug: id,
    name: id === "host" ? "Ada" : "Miles",
    personality: "curious",
    voice: {
      id: `voice-${id}`,
      name: "Voice",
      description: "",
      provider: VocalProviderName.ElevenLabs,
      providerId: "provider-id",
      settings: {},
    },
    voiceStyle: "neutral",
    isExpert,
  };
}

function makeSpeech(speaker: Speaker): Speech {
  return {
    id: `speech-${speaker.id}`,
    speaker,
    message: "Hello",
    instructions: "warm",
    voice: speaker.voice,
    voiceStyle: speaker.voiceStyle,
    timestamp: new Date(),
  };
}

function makeScript(speeches: Speech[] = []): PodcastScript {
  const expert = makeSpeaker("expert", true);
  const host = makeSpeaker("host", false);
  return {
    id: "script-1",
    title: "The Secret Signals of Fungi",
    description: "",
    speakers: [expert, host],
    speeches,
    materials: [],
    discussionPoints: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("OpeningSequencePolicy", () => {
  it("opens cold with a hook before any welcome, for the host", () => {
    const policy = new OpeningSequencePolicy();
    const script = makeScript();

    expect(policy.getStage(script)).toBe(OpeningStage.Hook);

    const turn = policy.nextTurn(script);

    expect(turn?.speaker.name).toBe("Ada");
    expect(turn?.forceColdOpen).toBe(true);
    expect(turn?.direction).toContain("Open cold");
    expect(turn?.direction).toContain("Do not");
  });

  it("grounds the hook in the highest-storyValue editorial card", () => {
    const policy = new OpeningSequencePolicy();
    const script = makeScript();
    const lowValueCard: EditorialCard = {
      id: "card-low",
      materialId: "material-1",
      kind: EditorialCardKind.Background,
      content: "Background detail",
      significance: "",
      evidence: [],
      relatedCardIds: [],
      tags: [],
      keyTerms: [],
      storyValue: 4,
    };
    const highValueCard: EditorialCard = {
      id: "card-high",
      materialId: "material-1",
      kind: EditorialCardKind.Surprise,
      content: "Fungi synchronise electrical spikes with each other",
      significance: "",
      evidence: [],
      relatedCardIds: [],
      tags: [],
      keyTerms: [],
      storyValue: 10,
    };
    script.editorialCards = [lowValueCard, highValueCard];

    const turn = policy.nextTurn(script);

    expect(turn?.turnBrief.cardIds).toEqual(["card-high"]);
    expect(turn?.turnBrief.knowledgeSource).toBe(KnowledgeSource.PreparedCard);
  });

  it("falls back to common knowledge when no editorial cards are prepared", () => {
    const policy = new OpeningSequencePolicy();
    const script = makeScript();

    const turn = policy.nextTurn(script);

    expect(turn?.turnBrief.cardIds).toEqual([]);
    expect(turn?.turnBrief.knowledgeSource).toBe(KnowledgeSource.CommonKnowledge);
  });

  it("moves to Welcome only after the hook turn has been spoken", () => {
    const policy = new OpeningSequencePolicy();
    const script = makeScript();
    const host = script.speakers.find((speaker) => !speaker.isExpert)!;
    script.speeches.push(makeSpeech(host)); // hook turn spoken

    expect(policy.getStage(script)).toBe(OpeningStage.Welcome);

    const turn = policy.nextTurn(script);

    expect(turn?.forceColdOpen).toBe(false);
    expect(turn?.direction).toContain('name the episode "The Secret Signals of Fungi"');
  });

  it("applies the hook stage to solo episodes too", () => {
    const policy = new OpeningSequencePolicy();
    const script = makeScript();
    script.speakers = [script.speakers.find((speaker) => !speaker.isExpert)!];

    expect(policy.getStage(script)).toBe(OpeningStage.Hook);
    expect(policy.nextTurn(script)?.forceColdOpen).toBe(true);
  });

  it("forces the interviewer to welcome, introduce and stop after the hook", () => {
    const policy = new OpeningSequencePolicy();
    const script = makeScript();
    const host = script.speakers.find((speaker) => !speaker.isExpert)!;
    script.speeches.push(makeSpeech(host)); // hook turn spoken

    const turn = policy.nextTurn(script);

    expect(turn?.speaker.name).toBe("Ada");
    expect(turn?.direction).toContain('name the episode "The Secret Signals of Fungi"');
    expect(turn?.direction).toContain("introduce Miles");
    expect(turn?.direction).toContain("End immediately");
    expect(turn?.direction).toContain("Do not introduce the subject");
  });

  it("forces the introduced co-host to acknowledge the greeting next", () => {
    const policy = new OpeningSequencePolicy();
    const script = makeScript();
    const host = script.speakers.find((speaker) => !speaker.isExpert)!;
    script.speeches.push(makeSpeech(host), makeSpeech(host)); // hook + welcome spoken

    const turn = policy.nextTurn(script);

    expect(policy.getStage(script)).toBe(OpeningStage.Acknowledgements);
    expect(turn?.speaker.name).toBe("Miles");
    expect(turn?.direction).toContain("Respond directly to Ada's introduction");
    expect(turn?.direction).toContain("then stop");
    expect(turn?.direction).toContain("Do not introduce the subject");
  });

  it("hands control to the editorial director after every speaker has greeted", () => {
    const policy = new OpeningSequencePolicy();
    const script = makeScript();
    const host = script.speakers.find((speaker) => !speaker.isExpert)!;
    const expert = script.speakers.find((speaker) => speaker.isExpert)!;
    script.speeches.push(makeSpeech(host), makeSpeech(host), makeSpeech(expert)); // hook + welcome + ack

    expect(policy.getStage(script)).toBe(OpeningStage.Complete);
    expect(policy.nextTurn(script)).toBeNull();
  });
});
