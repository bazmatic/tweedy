import { describe, expect, it } from "vitest";
import {
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
  it("forces the interviewer to welcome, introduce and stop on the first turn", () => {
    const policy = new OpeningSequencePolicy();
    const turn = policy.nextTurn(makeScript());

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
    script.speeches.push(makeSpeech(host));

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
    script.speeches.push(makeSpeech(host), makeSpeech(expert));

    expect(policy.getStage(script)).toBe(OpeningStage.Complete);
    expect(policy.nextTurn(script)).toBeNull();
  });
});
