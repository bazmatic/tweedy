import { describe, expect, it } from "vitest";
import {
  PodcastScript,
  Speaker,
  Speech,
  VocalProviderName,
} from "../types";
import { TerminologyLedgerPolicy } from "./TerminologyLedgerPolicy";

function makeSpeaker(): Speaker {
  return {
    id: "expert",
    slug: "expert",
    name: "Expert",
    personality: "clear",
    voice: {
      id: "voice",
      name: "Voice",
      description: "",
      provider: VocalProviderName.ElevenLabs,
      providerId: "provider",
      settings: {},
    },
    voiceStyle: "natural",
    isExpert: true,
  };
}

function makeScript(): PodcastScript {
  return {
    id: "script",
    title: "Test",
    description: "",
    speakers: [makeSpeaker()],
    speeches: [],
    materials: [],
    discussionPoints: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeSpeech(message: string): Speech {
  const speaker = makeSpeaker();
  return {
    id: "speech",
    speaker,
    message,
    instructions: "natural",
    voice: speaker.voice,
    voiceStyle: speaker.voiceStyle,
    timestamp: new Date(),
    review: {
      accepted: true,
      clear: true,
      engaging: true,
      grounded: true,
      advancesBeat: true,
      addsVariety: true,
      introducedTerms: [
        {
          term: "Shannon entropy",
          plainLanguageMeaning: "how unpredictable the signal is",
        },
      ],
    },
  };
}

describe("TerminologyLedgerPolicy", () => {
  const policy = new TerminologyLedgerPolicy();

  it("records a reviewed term that appears in an accepted speech", () => {
    const script = makeScript();
    policy.recordAcceptedTurn(
      script,
      makeSpeech(
        "How unpredictable the signal is—that is what Shannon entropy measures."
      )
    );

    expect(script.terminologyLedger?.explainedTerms).toEqual([
      expect.objectContaining({
        term: "Shannon entropy",
        plainLanguageMeaning: "how unpredictable the signal is",
      }),
    ]);
  });

  it("rejects reviewer-invented terms and duplicate explanations", () => {
    const script = makeScript();
    script.terminologyLedger = {
      explainedTerms: [
        {
          term: "Shannon entropy",
          plainLanguageMeaning: "how unpredictable the signal is",
          explainedBySpeakerId: "expert",
          explainedAtTurn: 1,
        },
      ],
    };

    policy.recordAcceptedTurn(script, makeSpeech("This signal varies."));

    expect(script.terminologyLedger.explainedTerms).toHaveLength(1);
  });
});
