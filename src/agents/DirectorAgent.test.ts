import { describe, expect, it, vi } from "vitest";
import { DirectorAgent } from "./DirectorAgent";
import { ModelTask } from "../providers/ModelRoutingPolicy";
import { SpeakerAgentToolName } from "./speaker-tools";
import {
  EditorialCardKind,
  AudienceValue,
  BeatPurpose,
  EditorialMove,
  DiscussionPointPriority,
  EnergyLevel,
  EpistemicRole,
  PodcastMaterial,
  PodcastScript,
  SourceType,
  Speaker,
  Speech,
  VocalProviderName,
} from "../types";

function makeSpeaker(id: string): Speaker {
  return {
    id,
    slug: id,
    name: `Speaker ${id}`,
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
  };
}

function makeScript(overrides: Partial<PodcastScript> = {}): PodcastScript {
  return {
    id: "script-1",
    title: "Test Script",
    description: "A test script",
    speakers: [makeSpeaker("s1"), makeSpeaker("s2")],
    speeches: [],
    materials: [],
    discussionPoints: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function appendClosingSpeech(script: PodcastScript): void {
  const speaker = script.speakers[0];
  script.speeches.push({
    id: "closing",
    speaker,
    message: "Thanks for listening. Until next time.",
    instructions: "warm",
    voice: speaker.voice,
    voiceStyle: speaker.voiceStyle,
    timestamp: new Date(),
    tool: SpeakerAgentToolName.CLOSING_STATEMENT,
  });
}

function makeMaterial(overrides: Partial<PodcastMaterial> = {}): PodcastMaterial {
  return {
    id: "m1",
    title: "Some Article",
    content: "Full raw article content that should not appear verbatim.",
    source: "https://example.com",
    sourceType: SourceType.Web,
    metadata: {},
    createdAt: new Date(),
    ...overrides,
  };
}

describe("DirectorAgent.createPodcastPlan", () => {
  it("builds the plan prompt from prepared materials, not raw content", async () => {
    const material = makeMaterial();
    const script = makeScript({ materials: [material] });
    const materialPreparer = {
      prepare: vi.fn().mockResolvedValue({
        materialId: material.id,
        synopsis: "A concise podcast-ready summary of the article.",
        cards: [
          {
            id: "m1-card-1",
            materialId: material.id,
            kind: EditorialCardKind.Surprise,
            content: "A memorable detail.",
            evidence: [],
            relatedCardIds: [],
            tags: [],
          },
        ],
      }),
    };
    const agent = new DirectorAgent(
      script,
      { maxTurns: 10, maxDuration: 600 },
      undefined,
      { materialPreparer }
    );

    const callModelForStructuredOutputSpy = vi
      .spyOn(agent as any, "callModelForStructuredOutput")
      .mockResolvedValue({
        narrative: "Open with intros, then dig in.",
        points: ["Point A"],
      });

    await agent.createPodcastPlan();

    expect(callModelForStructuredOutputSpy.mock.calls[0][0]).toBe(
      ModelTask.EpisodePlanning
    );
    const promptContent = (callModelForStructuredOutputSpy.mock.calls[0][1] as any)[0]
      .content as string;
    expect(promptContent).toContain("A concise podcast-ready summary of the article.");
    expect(promptContent).not.toContain(material.content);
  });

  it("stores the planned central analogy on the script", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });
    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValue({
      narrative: "flow",
      points: ["p1"],
      centralAnalogy: "accounts are USB drives",
    });

    await agent.createPodcastPlan();

    expect(script.centralAnalogy).toBe("accounts are USB drives");
  });

  it("stores the planned narrative on the script for the opening frame beat", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });
    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValue({
      narrative: "1953 was a hinge year for science and geopolitics alike.",
      points: ["p1"],
    });

    await agent.createPodcastPlan();

    expect(script.narrative).toBe(
      "1953 was a hinge year for science and geopolitics alike."
    );
  });

  it("assigns sequential ids to points and stores them on the script", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });
    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValue({
      narrative: "Open with intros, then dig in.",
      points: ["Point A", "Point B", "Point C"],
    });

    await agent.createPodcastPlan();

    expect(script.discussionPoints).toEqual([
      expect.objectContaining({ id: "p1", text: "Point A", covered: false }),
      expect.objectContaining({ id: "p2", text: "Point B", covered: false }),
      expect.objectContaining({ id: "p3", text: "Point C", covered: false }),
    ]);
  });

  it("stores a listener-centred sequence of conversation beats", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });
    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValue({
      narrative: "Hook, explain, then pay off.",
      points: ["A turning point"],
      beats: [
        {
          purpose: BeatPurpose.Hook,
          goal: "Open with the surprising rejection letter.",
          cardIds: ["m1-card-1"],
          desiredEnergy: EnergyLevel.Curious,
          targetTurns: 1,
        },
      ],
    });

    await agent.createPodcastPlan();

    expect(script.conversationBeats).toEqual([
      expect.objectContaining({
        id: "b1",
        purpose: BeatPurpose.Hook,
        goal: "Open with the surprising rejection letter.",
        covered: false,
      }),
    ]);
  });

  it("appends a payoff claim when a planned beat raises evidence but never states what it means", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });
    const call = vi.spyOn(agent as any, "callModelForStructuredOutput");
    call.mockResolvedValueOnce({ assignments: [] }); // assignSpeakerRoles
    call.mockResolvedValueOnce({
      narrative: "Dig into the eDNA survey.",
      points: ["The eDNA survey found no reptile DNA"],
      beats: [
        {
          purpose: BeatPurpose.Explain,
          goal: "Explain the eDNA survey results.",
          claims: [
            { text: "Loch Ness is a large Scottish loch.", role: "context" },
            {
              text: "The eDNA survey found eel DNA but no reptile DNA.",
              role: "evidence",
              prerequisiteClaimIndexes: [0],
            },
          ],
        },
      ],
    }); // main plan
    call.mockResolvedValueOnce({
      text: "So whatever people are seeing, the DNA evidence rules out a surviving reptile.",
    }); // beat-closure repair

    await agent.createPodcastPlan();

    expect(call).toHaveBeenCalledTimes(3);
    expect(call.mock.calls[2][0]).toBe(ModelTask.EpisodePlanning);
    const claims = script.conversationBeats?.[0].discourseClaims ?? [];
    expect(claims).toHaveLength(3);
    expect(claims[2]).toEqual(
      expect.objectContaining({
        role: "payoff",
        text: "So whatever people are seeing, the DNA evidence rules out a surviving reptile.",
        prerequisiteClaimIds: [claims[0].id, claims[1].id],
      })
    );
  });

  it("does not call the repair model when a planned beat already resolves its evidence with a payoff or implication", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });
    const call = vi.spyOn(agent as any, "callModelForStructuredOutput");
    call.mockResolvedValueOnce({ assignments: [] }); // assignSpeakerRoles
    call.mockResolvedValueOnce({
      narrative: "Dig into the eDNA survey.",
      points: ["The eDNA survey found no reptile DNA"],
      beats: [
        {
          purpose: BeatPurpose.Explain,
          goal: "Explain the eDNA survey results.",
          claims: [
            {
              text: "The eDNA survey found eel DNA but no reptile DNA.",
              role: "evidence",
            },
            {
              text: "So a surviving reptile is ruled out.",
              role: "payoff",
              prerequisiteClaimIndexes: [0],
            },
          ],
        },
      ],
    }); // main plan

    await agent.createPodcastPlan();

    expect(call).toHaveBeenCalledTimes(2);
    expect(script.conversationBeats?.[0].discourseClaims).toHaveLength(2);
  });

  it("falls back to a generic closing claim when the repair call itself fails", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });
    const call = vi.spyOn(agent as any, "callModelForStructuredOutput");
    call.mockResolvedValueOnce({ assignments: [] }); // assignSpeakerRoles
    call.mockResolvedValueOnce({
      narrative: "Dig into the eDNA survey.",
      points: ["The eDNA survey found no reptile DNA"],
      beats: [
        {
          purpose: BeatPurpose.Explain,
          goal: "Explain the eDNA survey results.",
          claims: [
            {
              text: "The eDNA survey found eel DNA but no reptile DNA.",
              role: "evidence",
            },
          ],
        },
      ],
    }); // main plan
    call.mockRejectedValueOnce(new Error("model unavailable")); // beat-closure repair fails

    await agent.createPodcastPlan();

    const claims = script.conversationBeats?.[0].discourseClaims ?? [];
    expect(claims).toHaveLength(2);
    expect(claims[1]).toEqual(
      expect.objectContaining({
        role: "payoff",
        text: "What this means: Explain the eDNA survey results.",
      })
    );
  });

  it("sorts script.editorialCards by storyValue descending", async () => {
    const material = makeMaterial();
    const script = makeScript({ materials: [material] });
    const materialPreparer = {
      prepare: vi.fn().mockResolvedValue({
        materialId: material.id,
        synopsis: "Summary.",
        cards: [
          {
            id: "flat-card",
            materialId: material.id,
            kind: EditorialCardKind.EssentialPoint,
            content: "A flat but essential fact.",
            evidence: [],
            relatedCardIds: [],
            tags: [],
            keyTerms: [],
            storyValue: 3,
          },
          {
            id: "hook-card",
            materialId: material.id,
            kind: EditorialCardKind.Surprise,
            content: "A genuinely surprising hook.",
            evidence: [],
            relatedCardIds: [],
            tags: [],
            keyTerms: [],
            storyValue: 9,
          },
        ],
      }),
    };
    const agent = new DirectorAgent(
      script,
      { maxTurns: 10, maxDuration: 600 },
      undefined,
      { materialPreparer }
    );
    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValue({
      narrative: "plan",
      points: ["Point A"],
    });

    await agent.createPodcastPlan();

    expect(script.editorialCards?.map((card) => card.id)).toEqual([
      "hook-card",
      "flat-card",
    ]);
  });

  it("assigns at least one non-audience_guide role even when the model assigns none", async () => {
    const speakerA = makeSpeaker("a");
    const speakerB = makeSpeaker("b");
    const script = makeScript({ speakers: [speakerA, speakerB] });
    const director = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });

    vi.spyOn(director as any, "callModelForStructuredOutput").mockImplementation(
      (async (_task: unknown, _messages: unknown, schema: { description?: string }) => {
        if (schema?.description?.includes("Runtime epistemic role assignment")) {
          return {
            assignments: [
              { speakerId: "a", epistemicRole: "audience_guide" },
              { speakerId: "b", epistemicRole: "audience_guide" },
            ],
          };
        }
        return { points: ["p1"], narrative: "narrative", beats: [] };
      }) as any
    );

    await director.createPodcastPlan();

    const roles = script.speakers.map((speaker) => speaker.roleProfile?.epistemicRole);
    expect(roles).not.toEqual(["audience_guide", "audience_guide"]);
    expect(script.speakerRoleAssignments?.["a"]).toBeDefined();
    expect(script.speakerRoleAssignments?.["b"]).toBeDefined();
  });
});

describe("DirectorAgent editorial turn briefs", () => {
  it("returns the selected move and audience value as a structured brief", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });
    const call = vi.spyOn(agent as any, "callModelForStructuredOutput");
    call.mockResolvedValueOnce({ assignments: [] });
    call.mockResolvedValueOnce({ narrative: "plan", points: [] });
    await agent.createPodcastPlan();
    script.orientation!.status = "complete";
    call.mockResolvedValueOnce({
      speakerId: "s1",
      direction: "Tell the short backstage story.",
      goal: "Humanise the subject.",
      move: EditorialMove.TellStory,
      audienceValue: AudienceValue.Connection,
      desiredEnergy: EnergyLevel.Warm,
      cardIds: ["m1-card-1"],
      coveredPointIds: [],
    });

    const result = await agent.chooseNextSpeaker(script);

    expect(result.turnBrief).toEqual(
      expect.objectContaining({
        speakerId: "s1",
        goal: "Humanise the subject.",
        move: EditorialMove.TellStory,
        audienceValue: AudienceValue.Connection,
        desiredEnergy: EnergyLevel.Warm,
      })
    );
  });

  it("presents editorial cards highest-storyValue-first and caps the listing at 20", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });
    const call = vi.spyOn(agent as any, "callModelForStructuredOutput");
    call.mockResolvedValueOnce({ assignments: [] });
    call.mockResolvedValueOnce({ narrative: "plan", points: [] });
    await agent.createPodcastPlan();

    function makeEditorialCard(id: string, storyValue: number) {
      return {
        id,
        materialId: "m1",
        kind: EditorialCardKind.EssentialPoint,
        content: `Content for ${id}`,
        significance: "",
        evidence: [],
        relatedCardIds: [],
        tags: [],
        keyTerms: [],
        storyValue,
      };
    }
    // 21 cards in ascending storyValue order by id (card-0 lowest, card-20 highest).
    script.editorialCards = Array.from({ length: 21 }, (_, index) =>
      makeEditorialCard(`card-${index}`, index)
    );

    call.mockResolvedValueOnce({
      speakerId: "s1",
      direction: "Continue.",
      coveredPointIds: [],
    });

    await agent.chooseNextSpeaker(script);

    const promptContent = (call.mock.calls[2][1] as any)[0].content as string;
    const cardIdOrder = [...promptContent.matchAll(/- (card-\d+) \[/g)].map(
      (match) => match[1]
    );

    // The lowest-storyValue card (card-0) must be excluded by the 20-card cap.
    expect(cardIdOrder).not.toContain("card-0");
    expect(cardIdOrder).toHaveLength(20);
    // Highest storyValue (card-20) must appear first.
    expect(cardIdOrder[0]).toBe("card-20");
    expect(cardIdOrder[cardIdOrder.length - 1]).toBe("card-1");
  });

  it("tracks a beat only after an accepted reviewed speech advances it", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });
    const call = vi.spyOn(agent as any, "callModelForStructuredOutput");
    call.mockResolvedValueOnce({ assignments: [] });
    call.mockResolvedValueOnce({
      narrative: "plan",
      points: ["The main topic"],
      beats: [
        {
          purpose: BeatPurpose.Hook,
          goal: "Open with a vivid detail.",
        },
      ],
    });
    await agent.createPodcastPlan();
    call.mockResolvedValueOnce({
      speakerId: "s1",
      direction: "Move into the main topic.",
      coveredPointIds: [],
      coveredBeatIds: ["b1"],
    });

    await agent.chooseNextSpeaker(script);

    expect(script.conversationBeats?.[0].covered).toBe(false);
    agent.recordAcceptedBeat({
      id: "speech-1",
      speaker: script.speakers[0],
      message: "A vivid opening detail.",
      instructions: "",
      voice: script.speakers[0].voice,
      voiceStyle: script.speakers[0].voiceStyle,
      timestamp: new Date(),
      turnBrief: {
        speakerId: script.speakers[0].id,
        beatId: "b1",
        goal: "Open with a vivid detail.",
        move: EditorialMove.Illustrate,
        cardIds: [],
        audienceValue: AudienceValue.Entertainment,
        desiredEnergy: EnergyLevel.Energetic,
      },
      review: {
        accepted: true,
        clear: true,
        engaging: true,
        grounded: true,
        advancesBeat: true,
        addsVariety: true,
      },
    });

    expect(script.conversationBeats?.[0]).toEqual(
      expect.objectContaining({ covered: true, coveredAtTurn: 1 })
    );
    expect(script.discussionPoints[0].covered).toBe(false);
  });

  it("does not complete a discourse-contract beat from a generic advancesBeat review", () => {
    const script = makeScript();
    script.conversationBeats = [
      {
        id: "b1",
        purpose: BeatPurpose.Illustrate,
        goal: "Tell the sequence in order.",
        cardIds: [],
        prerequisiteBeatIds: [],
        desiredEnergy: EnergyLevel.Energetic,
        targetTurns: 3,
        pointIds: ["p1"],
        covered: false,
        discourseClaims: [
          {
            id: "b1-c1",
            beatId: "b1",
            text: "Establish the setup.",
            role: "context",
            prerequisiteClaimIds: [],
            state: "unheard",
            evidenceSpeechIds: [],
            attemptedTurns: 0,
          },
          {
            id: "b1-c2",
            beatId: "b1",
            text: "Deliver the consequence.",
            role: "implication",
            prerequisiteClaimIds: ["b1-c1"],
            state: "unheard",
            evidenceSpeechIds: [],
            attemptedTurns: 0,
          },
        ],
        completionClaimIds: ["b1-c1", "b1-c2"],
      },
    ];
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });

    agent.recordAcceptedBeat({
      id: "speech-1",
      speaker: script.speakers[0],
      message: "The setup.",
      instructions: "",
      voice: script.speakers[0].voice,
      voiceStyle: script.speakers[0].voiceStyle,
      timestamp: new Date(),
      turnBrief: {
        speakerId: script.speakers[0].id,
        beatId: "b1",
        targetDiscourseClaimIds: ["b1-c1"],
        goal: "Establish the setup.",
        move: EditorialMove.Explain,
        cardIds: [],
        audienceValue: AudienceValue.Understanding,
        desiredEnergy: EnergyLevel.Curious,
      },
      review: {
        accepted: true,
        clear: true,
        engaging: true,
        grounded: true,
        advancesBeat: true,
        addsVariety: true,
      },
    });

    expect(script.conversationBeats[0].covered).toBe(false);
  });
});

describe("DirectorAgent listener orientation", () => {
  it.each([
    {
      subject: "The Odyssey",
      scope: "A beginner's guide to the epic",
      centralQuestion: "What does it mean to come home?",
      claim: "Odysseus is trying to return to Ithaca after the Trojan War.",
    },
    {
      subject: "Fungal signalling",
      scope: "Evidence and uncertainty around fungal communication",
      centralQuestion: "When does signalling count as language?",
      claim: "Researchers measure chemical and electrical signals in fungi.",
    },
  ])("stores a domain-neutral contract for $subject", async (orientation) => {
    const script = makeScript();
    const agent = new DirectorAgent(script, {
      maxTurns: 10,
      maxDuration: 600,
    });
    vi.spyOn(agent as any, "callModelForStructuredOutput")
      .mockResolvedValueOnce({ assignments: [] })
      .mockResolvedValueOnce({
        narrative: "plan",
        points: [],
        orientation: {
          ...orientation,
          requiredClaims: [orientation.claim, "Explain why the question matters."],
          maxTurns: 2,
        },
      });

    await agent.createPodcastPlan();

    expect(script.orientation).toEqual(
      expect.objectContaining({
        subject: orientation.subject,
        scope: orientation.scope,
        centralQuestion: orientation.centralQuestion,
        maxTurns: 2,
        status: "active",
      })
    );
    expect(script.orientation?.requiredClaims[0].text).toBe(orientation.claim);
  });

  it("targets orientation before a higher-story-value payoff", async () => {
    const script = makeScript({
      orientation: {
        subject: "The Odyssey",
        scope: "A beginner introduction",
        centralQuestion: "What is this poem about?",
        requiredClaims: [
          {
            id: "o1",
            text: "Odysseus is trying to return home after the Trojan War.",
            required: true,
            covered: false,
          },
        ],
        maxTurns: 2,
        attemptedTurns: 0,
        status: "active",
      },
      discussionPoints: [
        {
          id: "p1",
          text: "Penelope's rooted bed is the emotional payoff.",
          priority: DiscussionPointPriority.Essential,
          storyValue: 10,
          estimatedTurns: 2,
          prerequisiteClaimIds: ["o1"],
          covered: false,
        },
      ],
    });
    const agent = new DirectorAgent(script, {
      maxTurns: 10,
      maxDuration: 600,
    });
    (agent as any).points = script.discussionPoints;
    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValue({
      speakerId: "s1",
      direction: "Set the scene.",
      coveredPointIds: [],
    });

    const turn = await agent.chooseNextSpeaker(script);

    expect(turn.turnBrief.targetOrientationClaimIds).toEqual(["o1"]);
    expect(turn.turnBrief.targetPointId).toBeUndefined();
    expect(turn.direction).toContain("Odysseus is trying to return home");
    expect(turn.direction).not.toContain("rooted bed");
  });

  it("marks unresolved orientation incomplete after its bounded attempts", async () => {
    const script = makeScript({
      orientation: {
        subject: "A difficult subject",
        scope: "An introduction",
        centralQuestion: "What is it?",
        requiredClaims: [
          {
            id: "o1",
            text: "Establish the basic subject.",
            required: true,
            covered: false,
          },
        ],
        maxTurns: 1,
        attemptedTurns: 0,
        status: "active",
      },
    });
    const agent = new DirectorAgent(script, {
      maxTurns: 10,
      maxDuration: 600,
    });
    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValue({
      confirmedPointIds: [],
    });
    const speech = {
      id: "orientation-attempt",
      speaker: script.speakers[0],
      message: "A vague introduction.",
      instructions: "",
      voice: script.speakers[0].voice,
      voiceStyle: script.speakers[0].voiceStyle,
      timestamp: new Date(),
      turnBrief: {
        speakerId: "s1",
        goal: "Orient",
        move: EditorialMove.Explain,
        cardIds: [],
        audienceValue: AudienceValue.Understanding,
        desiredEnergy: EnergyLevel.Curious,
        targetOrientationClaimIds: ["o1"],
      },
    } as Speech;
    script.speeches.push(speech);

    await agent.recordAcceptedCoverage(script, speech);

    expect(script.orientation).toEqual(
      expect.objectContaining({
        attemptedTurns: 1,
        status: "incomplete",
        unresolvedClaimIds: ["o1"],
      })
    );
  });

  it("hides beats until their prerequisite beats are covered", () => {
    const script = makeScript({
      conversationBeats: [
        {
          id: "b1",
          purpose: BeatPurpose.Orient,
          goal: "Establish the subject.",
          cardIds: [],
          prerequisiteBeatIds: [],
          desiredEnergy: EnergyLevel.Curious,
          targetTurns: 1,
          covered: false,
        },
        {
          id: "b2",
          purpose: BeatPurpose.Payoff,
          goal: "Deliver the advanced payoff.",
          cardIds: [],
          prerequisiteBeatIds: ["b1"],
          desiredEnergy: EnergyLevel.Reflective,
          targetTurns: 1,
          covered: false,
        },
      ],
    });
    const agent = new DirectorAgent(script, {
      maxTurns: 10,
      maxDuration: 600,
    });

    const before = (agent as any).getEditorialSection(script);
    expect(before).toContain("Establish the subject");
    expect(before).not.toContain("advanced payoff");

    script.conversationBeats![0].covered = true;
    const after = (agent as any).getEditorialSection(script);
    expect(after).toContain("advanced payoff");
  });
});

describe("DirectorAgent local discourse contracts", () => {
  function cyclopsScript(): PodcastScript {
    return makeScript({
      orientation: {
        subject: "The Odyssey",
        scope: "A beginner introduction",
        centralQuestion: "How does Odysseus get home?",
        requiredClaims: [],
        maxTurns: 2,
        attemptedTurns: 0,
        status: "complete",
      },
      discussionPoints: [
        {
          id: "p1",
          text: "Odysseus's cunning and pride in the Cyclops episode.",
          priority: DiscussionPointPriority.Essential,
          storyValue: 10,
          estimatedTurns: 3,
          covered: false,
        },
      ],
      conversationBeats: [
        {
          id: "b1",
          purpose: BeatPurpose.Illustrate,
          goal: "Explain the Cyclops episode.",
          cardIds: ["cyclops-card"],
          prerequisiteBeatIds: [],
          desiredEnergy: EnergyLevel.Tense,
          targetTurns: 3,
          pointIds: ["p1"],
          covered: false,
          discourseClaims: [
            {
              id: "b1-c1",
              beatId: "b1",
              text: "Odysseus and his crew are trapped by the Cyclops Polyphemus.",
              role: "context",
              prerequisiteClaimIds: [],
              state: "unheard",
              evidenceSpeechIds: [],
              attemptedTurns: 0,
            },
            {
              id: "b1-c2",
              beatId: "b1",
              text: "Odysseus calls himself Nobody, blinds Polyphemus, and escapes.",
              role: "example",
              prerequisiteClaimIds: ["b1-c1"],
              state: "unheard",
              evidenceSpeechIds: [],
              attemptedTurns: 0,
            },
            {
              id: "b1-c3",
              beatId: "b1",
              text: "Once safe, Odysseus reveals his name because he wants credit.",
              role: "complication",
              prerequisiteClaimIds: ["b1-c2"],
              state: "unheard",
              evidenceSpeechIds: [],
              attemptedTurns: 0,
            },
          ],
          completionClaimIds: ["b1-c1", "b1-c2", "b1-c3"],
        },
      ],
    });
  }

  it("schedules the Cyclops setup before the tempting complication", async () => {
    const script = cyclopsScript();
    const agent = new DirectorAgent(script, {
      maxTurns: 10,
      maxDuration: 600,
    });
    (agent as any).points = script.discussionPoints;
    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValue({
      speakerId: "s1",
      direction: "How does he blow it with the Cyclops?",
      coveredPointIds: [],
    });

    const turn = await agent.chooseNextSpeaker(script);

    expect(turn.turnBrief.targetDiscourseClaimIds).toEqual(["b1-c1"]);
    expect(turn.turnBrief.requiredListenerClaimIds).toEqual([]);
    expect(turn.direction).toContain("trapped by the Cyclops Polyphemus");
    expect(turn.direction).not.toContain("How does he blow it");
    expect(turn.direction).toContain("Do not ask a question");
    expect(turn.direction).toContain(
      "Every pronoun or shorthand reference must point to"
    );
  });

  it("marks a point covered directly once the Director's claim is independently verified, without requiring its discourse contract to complete first", async () => {
    const script = cyclopsScript();
    const agent = new DirectorAgent(script, {
      maxTurns: 10,
      maxDuration: 600,
    });
    (agent as any).points = script.discussionPoints;
    const call = vi
      .spyOn(agent as any, "callModelForStructuredOutput")
      .mockResolvedValueOnce({
        speakerId: "s1",
        direction: "Move on.",
        coveredPointIds: ["p1"],
      })
      .mockResolvedValueOnce({ confirmedPointIds: ["p1"] });

    await agent.chooseNextSpeaker(script);

    expect(call).toHaveBeenCalledTimes(2);
    expect(script.discussionPoints[0].covered).toBe(true);
    expect(script.conversationBeats![0].covered).toBe(false);
  });

  it("advances only after accepted transcript evidence establishes a claim", async () => {
    const script = cyclopsScript();
    const agent = new DirectorAgent(script, {
      maxTurns: 10,
      maxDuration: 600,
    });
    (agent as any).points = script.discussionPoints;
    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValue({
      confirmedPointIds: ["b1-c1"],
    });
    const speech = {
      id: "setup-speech",
      speaker: script.speakers[0],
      message:
        "Odysseus and his crew enter Polyphemus's cave and become trapped by the one-eyed giant.",
      instructions: "",
      voice: script.speakers[0].voice,
      voiceStyle: script.speakers[0].voiceStyle,
      timestamp: new Date(),
      turnBrief: {
        speakerId: "s1",
        goal: "Establish the setup.",
        move: EditorialMove.Explain,
        cardIds: [],
        audienceValue: AudienceValue.Understanding,
        desiredEnergy: EnergyLevel.Tense,
        targetPointId: "p1",
        targetDiscourseClaimIds: ["b1-c1"],
        requiredListenerClaimIds: [],
      },
    } as Speech;
    script.speeches.push(speech);

    await agent.recordAcceptedCoverage(script, speech);

    expect(script.conversationBeats![0].discourseClaims![0]).toEqual(
      expect.objectContaining({
        state: "established",
        evidenceSpeechIds: ["setup-speech"],
      })
    );
    expect(script.discussionPoints[0].covered).toBe(false);
  });
});

describe("DirectorAgent fixed speaker note", () => {
  it("omits the fixed-speaker note with more than two speakers", async () => {
    const s3 = makeSpeaker("s3");
    const script = makeScript({
      speakers: [makeSpeaker("s1"), makeSpeaker("s2"), s3],
    });
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });
    const call = vi.spyOn(agent as any, "callModelForStructuredOutput");
    call.mockResolvedValueOnce({
      speakerId: "s1",
      direction: "Continue.",
      coveredPointIds: [],
    });

    await agent.chooseNextSpeaker(script);

    const promptContent = (call.mock.calls[0][1] as any).at(-1).content as string;
    expect(promptContent).not.toContain("already fixed by production");
  });
});

describe("DirectorAgent interjection acknowledgment", () => {
  it("tells the resuming speaker to acknowledge a preceding brief reaction", async () => {
    const script = makeScript();
    const [s1, s2] = script.speakers;
    script.speeches.push(
      {
        id: "sp1",
        speaker: s1,
        message: "So the key insight here is...",
        instructions: "",
        voice: s1.voice,
        voiceStyle: s1.voiceStyle,
        timestamp: new Date(),
        tool: SpeakerAgentToolName.SPEAK,
      },
      {
        id: "sp2",
        speaker: s2,
        message: "Wait, really?",
        instructions: "",
        voice: s2.voice,
        voiceStyle: s2.voiceStyle,
        timestamp: new Date(),
        tool: SpeakerAgentToolName.INTERJECT,
      }
    );

    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });
    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      speakerId: "s1",
      direction: "Continue explaining.",
      coveredPointIds: [],
    });

    const result = await agent.chooseNextSpeaker(script);

    expect(result.speaker.id).toBe("s1");
    expect(result.direction).toContain("Wait, really?");
    expect(result.direction).toMatch(/acknowledge it in the opening few words/i);
  });

  it("does not add the acknowledgment note when the last turn was substantive", async () => {
    const script = makeScript();
    const [s1, s2] = script.speakers;
    script.speeches.push({
      id: "sp1",
      speaker: s2,
      message: "Here's a full explanation of the concept.",
      instructions: "",
      voice: s2.voice,
      voiceStyle: s2.voiceStyle,
      timestamp: new Date(),
      tool: SpeakerAgentToolName.SPEAK,
    });

    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });
    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      speakerId: "s1",
      direction: "Continue.",
      coveredPointIds: [],
    });

    const result = await agent.chooseNextSpeaker(script);

    expect(result.direction).not.toMatch(/acknowledge it in the opening few words/i);
  });
});

describe("DirectorAgent.chooseNextSpeaker coverage tracking", () => {
  it("marks points covered from coveredPointIds and reflects it on the next call's prompt", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });

    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      assignments: [],
    });
    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      narrative: "plan",
      points: ["Point A", "Point B"],
    });
    await agent.createPodcastPlan();

    const chooseSpy = vi.spyOn(agent as any, "callModelForStructuredOutput");
    chooseSpy.mockResolvedValueOnce({
      speakerId: "s1",
      direction: "Talk about A",
      coveredPointIds: ["p1"],
    });
    // Verification call confirms the claim.
    chooseSpy.mockResolvedValueOnce({ confirmedPointIds: ["p1"] });

    await agent.chooseNextSpeaker(script);

    expect(script.discussionPoints.find((p) => p.id === "p1")?.covered).toBe(true);
    expect(script.discussionPoints.find((p) => p.id === "p2")?.covered).toBe(false);

    chooseSpy.mockResolvedValueOnce({
      speakerId: "s2",
      direction: "Talk about B",
      coveredPointIds: [],
    });

    await agent.chooseNextSpeaker(script);

    const prompt = (chooseSpy.mock.calls[4][1] as any)[0].content as string;
    expect(prompt).toContain("p2 [supporting");
    expect(prompt).not.toContain("p1 [supporting");
  });

  it("does not mark a point covered if verification rejects the director's claim (hallucination regression)", async () => {
    // Regression test for a bug where the director claimed a point was
    // covered because the speech mentioned a topically-adjacent detail
    // (an oxygen tank explosion) rather than the point's actual specific
    // content (the CO2 scrubber duct-tape hack).
    const script = makeScript({
      speeches: [
        {
          id: "sp1",
          speaker: makeSpeaker("s1"),
          message:
            "The oxygen tank explosion crippled the spacecraft's power and life support systems.",
          instructions: "",
          voice: makeSpeaker("s1").voice,
          voiceStyle: "neutral",
          timestamp: new Date(),
        },
      ],
    });
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });

    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      assignments: [],
    });
    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      narrative: "plan",
      points: ["CO2 scrubber duct-tape hack"],
    });
    await agent.createPodcastPlan();

    const chooseSpy = vi.spyOn(agent as any, "callModelForStructuredOutput");
    chooseSpy.mockResolvedValueOnce({
      speakerId: "s1",
      direction: "Keep going",
      coveredPointIds: ["p1"],
    });
    // Verification call rejects the hallucinated claim.
    chooseSpy.mockResolvedValueOnce({ confirmedPointIds: [] });

    await agent.chooseNextSpeaker(script);

    expect(script.discussionPoints.find((p) => p.id === "p1")?.covered).toBe(
      false
    );
  });

  it("skips verification and applies coveredPointIds directly when there are no candidate points", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });

    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      assignments: [],
    });
    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      assignments: [],
    });
    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      narrative: "plan",
      points: ["Point A"],
    });
    await agent.createPodcastPlan();

    const chooseSpy = vi.spyOn(agent as any, "callModelForStructuredOutput");
    chooseSpy.mockResolvedValueOnce({
      speakerId: "s1",
      direction: "Talk",
      coveredPointIds: [],
    });

    await agent.chooseNextSpeaker(script);

    // createPodcastPlan's two calls (assignSpeakerRoles + plan creation) plus
    // chooseNextSpeaker's call should have happened — no verification call,
    // since there were no claimed points.
    expect(chooseSpy).toHaveBeenCalledTimes(3);
  });
});

describe("DirectorAgent progress / wrap-up pacing", () => {
  it("drives progress and the nearly-out-of-time nudge from estimated duration, not turn count", async () => {
    // 300 words at 150 wpm = 2 minutes elapsed against a 2m20s budget
    // (140s) => ~86% duration progress, well past the 85% threshold,
    // even though only a single turn has been used out of a maxTurns of 10.
    const script = makeScript({
      speeches: [
        {
          id: "sp1",
          speaker: makeSpeaker("s1"),
          message: new Array(300).fill("word").join(" "),
          instructions: "",
          voice: makeSpeaker("s1").voice,
          voiceStyle: "neutral",
          timestamp: new Date(),
        },
      ],
    });
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 140 });

    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      assignments: [],
    });
    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      narrative: "plan",
      points: [],
    });
    await agent.createPodcastPlan();

    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      speakerId: "s1",
      direction: "keep going",
      coveredPointIds: [],
    });

    const result = await agent.chooseNextSpeaker(script);

    expect(result.forceNearlyOutOfTime).toBe(true);
    expect(result.timeStatus).toContain("almost out of time");
    expect(result.timeStatus).toContain("must resolve it");
  });

  it("does not treat rising turn count alone as progress when duration is still low", async () => {
    // No speeches ever added, so estimated elapsed duration stays at 0
    // regardless of how many turns are consumed; turnsUsed climbing toward
    // maxTurns should not trigger the nearly-out-of-time nudge on its own.
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 5, maxDuration: 600 });

    const callModelSpy = vi
      .spyOn(agent as any, "callModelForStructuredOutput")
      .mockResolvedValue({
        speakerId: "s1",
        direction: "keep going",
        coveredPointIds: [],
      });
    callModelSpy.mockResolvedValueOnce({ narrative: "plan", points: [] });
    await agent.createPodcastPlan();
    script.orientation!.status = "complete";

    // Consume turns up to (but not including) the maxTurns safety ceiling.
    let result;
    for (let i = 0; i < 4; i++) {
      result = await agent.chooseNextSpeaker(script);
    }

    expect(result!.forceNearlyOutOfTime).toBe(false);
    expect(result!.timeStatus).not.toContain("almost out of time");
  });

  it("still forces a hard close once turnsUsed reaches the maxTurns safety ceiling", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 3, maxDuration: 600 });

    const callModelSpy = vi
      .spyOn(agent as any, "callModelForStructuredOutput")
      .mockResolvedValue({
        speakerId: "s1",
        direction: "keep going",
        coveredPointIds: [],
      });
    callModelSpy.mockResolvedValueOnce({ narrative: "plan", points: [] });
    await agent.createPodcastPlan();
    script.orientation!.status = "complete";

    let result;
    for (let i = 0; i < 3; i++) {
      result = await agent.chooseNextSpeaker(script);
    }

    expect(result!.timeStatus).toContain("final turn");
    expect(result!.timeStatus).toContain("throughline");
    expect(result!.forceNearlyOutOfTime).toBe(false);
  });
});

describe("DirectorAgent.isConversationComplete", () => {
  it("returns false without a model call when there are no discussion points", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });

    const callModelSpy = vi.spyOn(agent as any, "callModelForStructuredOutput");

    const result = await agent.isConversationComplete(script);

    expect(result).toBe(false);
    expect(callModelSpy).not.toHaveBeenCalled();
  });

  it("returns false without a model call when some points are still uncovered", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });

    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      assignments: [],
    });
    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      narrative: "plan",
      points: ["Point A", "Point B"],
    });
    await agent.createPodcastPlan();

    const callModelSpy = vi.spyOn(agent as any, "callModelForStructuredOutput");
    callModelSpy.mockClear();

    const result = await agent.isConversationComplete(script);

    expect(result).toBe(false);
    expect(callModelSpy).not.toHaveBeenCalled();
  });

  it("asks the model to judge natural conclusion once all points are covered, and returns true when it agrees", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });

    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      assignments: [],
    });
    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      narrative: "plan",
      points: ["Point A"],
    });
    await agent.createPodcastPlan();

    const chooseSpy = vi.spyOn(agent as any, "callModelForStructuredOutput");
    chooseSpy.mockResolvedValueOnce({
      speakerId: "s1",
      direction: "Talk about A",
      coveredPointIds: ["p1"],
    });
    chooseSpy.mockResolvedValueOnce({ confirmedPointIds: ["p1"] });
    await agent.chooseNextSpeaker(script);
    appendClosingSpeech(script);

    chooseSpy.mockResolvedValueOnce({ isComplete: true });

    const result = await agent.isConversationComplete(script);

    expect(result).toBe(true);
  });

  it("returns false when the model judges the conversation is not yet naturally concluded", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });

    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      assignments: [],
    });
    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      narrative: "plan",
      points: ["Point A"],
    });
    await agent.createPodcastPlan();

    const chooseSpy = vi.spyOn(agent as any, "callModelForStructuredOutput");
    chooseSpy.mockResolvedValueOnce({
      speakerId: "s1",
      direction: "Talk about A",
      coveredPointIds: ["p1"],
    });
    chooseSpy.mockResolvedValueOnce({ confirmedPointIds: ["p1"] });
    await agent.chooseNextSpeaker(script);
    appendClosingSpeech(script);

    chooseSpy.mockResolvedValueOnce({ isComplete: false });

    const result = await agent.isConversationComplete(script);

    expect(result).toBe(false);
  });

  it("returns false and does not throw if the completeness check fails", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });

    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      assignments: [],
    });
    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      narrative: "plan",
      points: ["Point A"],
    });
    await agent.createPodcastPlan();

    const chooseSpy = vi.spyOn(agent as any, "callModelForStructuredOutput");
    chooseSpy.mockResolvedValueOnce({
      speakerId: "s1",
      direction: "Talk about A",
      coveredPointIds: ["p1"],
    });
    chooseSpy.mockResolvedValueOnce({ confirmedPointIds: ["p1"] });
    await agent.chooseNextSpeaker(script);
    appendClosingSpeech(script);

    chooseSpy.mockRejectedValueOnce(new Error("model error"));

    const result = await agent.isConversationComplete(script);

    expect(result).toBe(false);
  });

  it("cannot finish after a summary without a dedicated sign-off", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });

    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      assignments: [],
    });
    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      narrative: "plan",
      points: ["Point A"],
    });
    await agent.createPodcastPlan();

    const chooseSpy = vi.spyOn(agent as any, "callModelForStructuredOutput");
    chooseSpy.mockResolvedValueOnce({
      speakerId: "s1",
      direction: "Talk about A",
      coveredPointIds: ["p1"],
    });
    chooseSpy.mockResolvedValueOnce({ confirmedPointIds: ["p1"] });
    await agent.chooseNextSpeaker(script);

    const speaker = script.speakers[0];
    script.speeches.push({
      id: "summary",
      speaker,
      message: "That is the key takeaway.",
      instructions: "reflective",
      voice: speaker.voice,
      voiceStyle: speaker.voiceStyle,
      timestamp: new Date(),
      tool: SpeakerAgentToolName.SUMMARIZE,
    });
    chooseSpy.mockClear();

    const result = await agent.isConversationComplete(script);

    expect(result).toBe(false);
    expect(chooseSpy).not.toHaveBeenCalled();
  });
});

describe("DirectorAgent balance note", () => {
  function makeSpeech(speaker: Speaker, wordCount: number, id = "sp"): PodcastScript["speeches"][number] {
    return {
      id,
      speaker,
      message: new Array(wordCount).fill("word").join(" "),
      instructions: "",
      voice: speaker.voice,
      voiceStyle: "neutral",
      timestamp: new Date(),
    };
  }

  it("does not add a balance note before enough speeches have happened", async () => {
    const s1 = makeSpeaker("s1");
    const s2 = makeSpeaker("s2");
    const script = makeScript({
      speakers: [s1, s2],
      speeches: [makeSpeech(s1, 100, "sp1")],
    });
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });

    const chooseSpy = vi
      .spyOn(agent as any, "callModelForStructuredOutput")
      .mockResolvedValueOnce({ assignments: [] })
      .mockResolvedValueOnce({ narrative: "plan", points: [] });
    await agent.createPodcastPlan();

    chooseSpy.mockResolvedValueOnce({
      speakerId: "s2",
      direction: "keep going",
      coveredPointIds: [],
    });
    await agent.chooseNextSpeaker(script);

    const prompt = (chooseSpy.mock.calls[2][1] as any).at(-1).content as string;
    expect(prompt).not.toContain("dominated the conversation");
  });

  it("does not flag an expert speaker even with a dominant word share", async () => {
    const s1 = makeSpeaker("s1");
    const s2 = makeSpeaker("s2");
    const script = makeScript({
      speakers: [s1, s2],
      speeches: [
        makeSpeech(s1, 100, "sp1"),
        makeSpeech(s2, 10, "sp2"),
        makeSpeech(s1, 100, "sp3"),
      ],
    });
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });

    const chooseSpy = vi
      .spyOn(agent as any, "callModelForStructuredOutput")
      .mockResolvedValueOnce({
        assignments: [{ speakerId: "s1", epistemicRole: EpistemicRole.Expert }],
      })
      .mockResolvedValueOnce({ narrative: "plan", points: [] });
    await agent.createPodcastPlan();

    chooseSpy.mockResolvedValueOnce({
      speakerId: "s2",
      direction: "keep going",
      coveredPointIds: [],
    });
    await agent.chooseNextSpeaker(script);

    const prompt = (chooseSpy.mock.calls[2][1] as any)[0].content as string;
    expect(prompt).not.toContain("dominated the conversation");
  });
});

describe("DirectorAgent.reviewSpeech", () => {
  function makeReviewSpeech(): Speech {
    const speaker = makeSpeaker("s1");
    return {
      id: "sp1",
      speaker,
      message: "Original message.",
      instructions: "",
      voice: speaker.voice,
      voiceStyle: "neutral",
      timestamp: new Date(),
    };
  }

  it("returns the speech unchanged when the director judges it fine", async () => {
    const script = makeScript();
    const turnReviewer = {
      review: vi.fn().mockResolvedValue({
        accepted: true,
        clear: true,
        engaging: true,
        grounded: true,
        advancesBeat: true,
        addsVariety: true,
      }),
    };
    const agent = new DirectorAgent(
      script,
      { maxTurns: 10, maxDuration: 600 },
      undefined,
      { turnReviewer }
    );

    const speech = makeReviewSpeech();
    const result = await agent.reviewSpeech(speech, "Talk about X");

    expect(result.message).toBe("Original message.");
    expect(result.review?.accepted).toBe(true);
  });

  it("replaces the message with the director's revision when flagged", async () => {
    const script = makeScript();
    const turnReviewer = {
      review: vi
        .fn()
        .mockResolvedValueOnce({
          accepted: false,
          clear: true,
          engaging: true,
          grounded: true,
          advancesBeat: false,
          addsVariety: true,
          revisedMessage: "A tighter, corrected version.",
        })
        .mockResolvedValueOnce({
          accepted: true,
          clear: true,
          engaging: true,
          grounded: true,
          advancesBeat: true,
          addsVariety: true,
          roleConsistent: true,
          knowledgeConsistent: true,
        }),
    };
    const agent = new DirectorAgent(
      script,
      { maxTurns: 10, maxDuration: 600 },
      undefined,
      { turnReviewer }
    );

    const speech = makeReviewSpeech();
    const result = await agent.reviewSpeech(speech, "Talk about X, briefly");

    expect(result.message).toBe("A tighter, corrected version.");
    expect(result).not.toBe(speech);
    expect(turnReviewer.review).toHaveBeenCalledTimes(2);
  });

  it("tells the reviewer what problem its own revision is meant to fix, on re-review", async () => {
    const script = makeScript();
    const turnReviewer = {
      review: vi
        .fn()
        .mockResolvedValueOnce({
          accepted: false,
          clear: true,
          engaging: true,
          grounded: true,
          advancesBeat: false,
          addsVariety: true,
          revisedMessage: "A tighter, corrected version.",
          feedback: "Doesn't advance the beat",
        })
        .mockResolvedValueOnce({
          accepted: true,
          clear: true,
          engaging: true,
          grounded: true,
          advancesBeat: true,
          addsVariety: true,
          roleConsistent: true,
          knowledgeConsistent: true,
        }),
    };
    const agent = new DirectorAgent(
      script,
      { maxTurns: 10, maxDuration: 600 },
      undefined,
      { turnReviewer }
    );

    const speech = makeReviewSpeech();
    await agent.reviewSpeech(speech, "Talk about X, briefly");

    expect(turnReviewer.review.mock.calls[1][8]).toBe(
      "Doesn't advance the beat"
    );
  });

  it("returns the original as rejected when the proposed revision is visibly truncated", async () => {
    const script = makeScript();
    const turnReviewer = {
      review: vi.fn().mockResolvedValue({
        accepted: false,
        clear: true,
        engaging: true,
        grounded: true,
        advancesBeat: false,
        addsVariety: true,
        revisedMessage: "A sprawling network weaving through the soil,",
      }),
    };
    const agent = new DirectorAgent(
      script,
      { maxTurns: 10, maxDuration: 600 },
      undefined,
      { turnReviewer }
    );

    const speech = makeReviewSpeech();
    const result = await agent.reviewSpeech(speech, "Talk about X");

    expect(result.message).toBe(speech.message);
    expect(result.review?.accepted).toBe(false);
    expect(turnReviewer.review).toHaveBeenCalledTimes(1);
  });

  it("keeps the original rejected when the reviewer's revision also fails review", async () => {
    const script = makeScript();
    const turnReviewer = {
      review: vi
        .fn()
        .mockResolvedValueOnce({
          accepted: false,
          clear: false,
          engaging: true,
          grounded: true,
          advancesBeat: false,
          addsVariety: true,
          revisedMessage: "A proposed correction.",
          feedback: "Missing listener context",
        })
        .mockResolvedValueOnce({
          accepted: false,
          clear: false,
          engaging: true,
          grounded: true,
          advancesBeat: false,
          addsVariety: true,
          feedback: "Still missing listener context",
        }),
    };
    const agent = new DirectorAgent(
      script,
      { maxTurns: 10, maxDuration: 600 },
      undefined,
      { turnReviewer }
    );

    const result = await agent.reviewSpeech(makeReviewSpeech(), "Talk about X");

    expect(result.message).toBe("Original message.");
    expect(result.review?.accepted).toBe(false);
    expect(turnReviewer.review).toHaveBeenCalledTimes(2);
  });

  it("returns the speech unchanged if the review call fails", async () => {
    const script = makeScript();
    const turnReviewer = {
      review: vi.fn().mockRejectedValue(new Error("model error")),
    };
    const agent = new DirectorAgent(
      script,
      { maxTurns: 10, maxDuration: 600 },
      undefined,
      { turnReviewer }
    );

    const speech = makeReviewSpeech();
    const result = await agent.reviewSpeech(speech, "Talk about X");

    expect(result.message).toBe(speech.message);
  });
});

describe("DirectorAgent velocity / pacing", () => {
  it("ranks essential and high-story-value open points ahead of optional points", () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 120 });
    (agent as any).points = [
      {
        id: "optional",
        text: "Optional detail",
        covered: false,
        priority: DiscussionPointPriority.Optional,
        storyValue: 10,
        estimatedTurns: 1,
      },
      {
        id: "essential",
        text: "Central promise",
        covered: false,
        priority: DiscussionPointPriority.Essential,
        storyValue: 6,
        estimatedTurns: 2,
      },
    ];

    const ranked = (agent as any).rankedOpenPoints();

    expect(ranked.map((point: any) => point.id)).toEqual([
      "essential",
      "optional",
    ]);
  });

  it("reserves closing capacity and omits only lower-ranked work that cannot fit", () => {
    const script = makeScript();
    script.speeches = [
      {
        id: "elapsed",
        speaker: script.speakers[0],
        message: Array(600).fill("word").join(" "),
        instructions: "",
        voice: script.speakers[0].voice,
        voiceStyle: script.speakers[0].voiceStyle,
        timestamp: new Date(),
      },
    ];
    script.discussionPoints = [
      {
        id: "essential",
        text: "Essential foundation",
        covered: false,
        priority: DiscussionPointPriority.Essential,
        storyValue: 9,
        estimatedTurns: 2,
      },
      {
        id: "supporting",
        text: "Supporting explanation",
        covered: false,
        priority: DiscussionPointPriority.Supporting,
        storyValue: 8,
        estimatedTurns: 8,
      },
      {
        id: "optional",
        text: "Optional anecdote",
        covered: false,
        priority: DiscussionPointPriority.Optional,
        storyValue: 10,
        estimatedTurns: 8,
      },
    ];
    const agent = new DirectorAgent(script, {
      maxTurns: 20,
      maxDuration: 600,
    });
    (agent as any).points = script.discussionPoints;
    (agent as any).turnsUsed = 5;

    (agent as any).pruneOpenPointsToBudget(script, {
      coveredCount: 0,
      openCount: 3,
      elapsedMinutes: 4,
      remainingMinutes: 6,
      paceStatus: "behind",
    });

    expect(script.discussionPoints[0].omitted).not.toBe(true);
    expect(script.discussionPoints[1].omitted).not.toBe(true);
    expect(script.discussionPoints[2]).toEqual(
      expect.objectContaining({
        omitted: true,
        omissionReason: "budget_priority",
      })
    );
  });

  it("makes the highest-ranked open point the next turn's explicit target", async () => {
    const script = makeScript({
      speakers: [makeSpeaker("s1"), makeSpeaker("s2")],
    });
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });
    const points = [
      {
        id: "optional",
        text: "Optional colour",
        covered: false,
        priority: DiscussionPointPriority.Optional,
        storyValue: 10,
        estimatedTurns: 1,
      },
      {
        id: "essential",
        text: "The episode's central promise",
        covered: false,
        priority: DiscussionPointPriority.Essential,
        storyValue: 6,
        estimatedTurns: 2,
      },
    ];
    (agent as any).points = points;
    script.discussionPoints = points;
    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValue({
      speakerId: "s1",
      direction: "Continue naturally.",
      coveredPointIds: [],
    });

    const result = await agent.chooseNextSpeaker(script);

    expect(result.turnBrief.targetPointId).toBe("essential");
    expect(result.direction).toContain(
      "Advance the scheduled point essential"
    );
  });

  it("verifies the scheduled point immediately after its speech is accepted", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });
    const point = {
      id: "p1",
      text: "Central promise",
      covered: false,
      priority: DiscussionPointPriority.Essential,
    };
    (agent as any).points = [point];
    script.discussionPoints = [point];
    vi.spyOn(agent as any, "verifyCoveredPoints").mockResolvedValue(["p1"]);
    const speaker = script.speakers[0];
    const speech = {
      id: "speech-1",
      speaker,
      message: "The central promise is now explained in concrete detail.",
      instructions: "",
      voice: speaker.voice,
      voiceStyle: speaker.voiceStyle,
      timestamp: new Date(),
      turnBrief: {
        speakerId: speaker.id,
        targetPointId: "p1",
        goal: "Explain the central promise.",
        move: EditorialMove.Explain,
        cardIds: [],
        audienceValue: AudienceValue.Understanding,
        desiredEnergy: EnergyLevel.Curious,
      },
    } as Speech;
    script.speeches.push(speech);

    await agent.recordAcceptedCoverage(script, speech);

    expect(point.covered).toBe(true);
  });

  it("records lower-ranked leftovers as explicit graceful omissions", () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 120 });
    const points = [
      {
        id: "covered",
        text: "Covered",
        covered: true,
        priority: DiscussionPointPriority.Essential,
      },
      {
        id: "omitted",
        text: "Optional detail",
        covered: false,
        priority: DiscussionPointPriority.Optional,
      },
    ];
    (agent as any).points = points;
    script.discussionPoints = points;

    agent.markRemainingPointsOmitted("duration_budget");

    expect(points[1]).toEqual(
      expect.objectContaining({
        omitted: true,
        omissionReason: "duration_budget",
      })
    );
    expect(script.productionOutcome).toEqual({
      status: "complete_with_omissions",
      completionReason: "duration_budget",
      omittedPointIds: ["omitted"],
      omissionSeverity: "optional_only",
    });
  });

  it("requests a summary turn when behind pace with 2+ open points", async () => {
    const script = makeScript({
      speeches: [
        {
          id: "sp1",
          speaker: makeSpeaker("s1"),
          message: new Array(150).fill("word").join(" "),
          instructions: "",
          voice: makeSpeaker("s1").voice,
          voiceStyle: "neutral",
          timestamp: new Date(),
        },
      ],
    });
    // 150 words already spoken at 150 wpm = 1 minute elapsed; a 2-minute
    // budget leaves 1 minute for 3 uncovered points — well behind pace.
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 120 });

    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      assignments: [],
    });
    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      narrative: "plan",
      points: ["Point A", "Point B", "Point C"],
    });
    await agent.createPodcastPlan();

    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      speakerId: "s1",
      direction: "keep going",
      coveredPointIds: [],
    });

    const result = await agent.chooseNextSpeaker(script);

    expect(result.requestSummary).toBe(true);
  });

  it("does not request a summary before there is any elapsed speaking time", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 6000 });

    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      assignments: [],
    });
    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      narrative: "plan",
      points: ["Point A"],
    });
    await agent.createPodcastPlan();

    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      speakerId: "s1",
      direction: "keep going",
      coveredPointIds: [],
    });

    const result = await agent.chooseNextSpeaker(script);

    expect(result.requestSummary).toBe(false);
  });
});

describe("DirectorAgent guidance", () => {
  it("includes producer guidance in the plan prompt when provided", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(
      script,
      { maxTurns: 10, maxDuration: 600 },
      "Keep it skeptical of the marketing claims."
    );
    const callModelForStructuredOutputSpy = vi
      .spyOn(agent as any, "callModelForStructuredOutput")
      .mockResolvedValue({ narrative: "Plan.", points: ["Point A"] });

    await agent.createPodcastPlan();

    const promptContent = (callModelForStructuredOutputSpy.mock.calls[1][1] as any)[0]
      .content as string;
    expect(promptContent).toContain("Keep it skeptical of the marketing claims.");
  });

  it("omits any guidance mention from the plan prompt when not provided", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });
    const callModelForStructuredOutputSpy = vi
      .spyOn(agent as any, "callModelForStructuredOutput")
      .mockResolvedValue({ narrative: "Plan.", points: ["Point A"] });

    await agent.createPodcastPlan();

    const promptContent = (callModelForStructuredOutputSpy.mock.calls[1][1] as any)[0]
      .content as string;
    expect(promptContent).not.toContain("producer");
  });

});
