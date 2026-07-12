# Director Burn-Rate / Discussion-Point Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the podcast director a structured list of discussion points, track coverage as the conversation proceeds, and compute a points-per-minute velocity signal so the director can steer pacing on content covered, not just on time/turns elapsed — including compressing multiple remaining points into one turn via a new `SUMMARIZE` speaker tool.

**Architecture:** `DirectorAgent.createPodcastPlan()` switches from a plain text completion to a tool-forced call that returns both the narrative plan and a list of discrete discussion points, which `DirectorAgent` turns into `DiscussionPoint[]` state. The existing `select_next_speaker` tool call (already made every turn in `chooseNextSpeaker`) gains an optional `coveredPointIds` field so the director marks coverage with no extra LLM round-trip. A new velocity calculation compares points-covered-per-minute against points-needed-per-minute to classify pace as `ahead`/`on-pace`/`behind`/`unknown`, feeding a new prompt note and a `requestSummary` flag that forces the new `SUMMARIZE` speaker tool (mirroring the existing `forceNearlyOutOfTime` mechanism). `PodcastScript`/`ScriptRecord` persist `discussionPoints` directly as plain JSON, and `ScriptService` logs any points never covered at the end of the episode.

**Tech Stack:** TypeScript, vitest, LangChain tool-calling via `BaseAgent.callModelForToolInput`/`callModelWithTools`.

## Global Constraints

- No new LLM call per turn — coverage marking must ride along on the existing `select_next_speaker` tool call.
- No explicit mid-episode "cut a point" mechanic — uncovered points are only ever reported, never force-dropped.
- `discussionPoints` persists directly in the script's JSON record (no new repository).
- Follow existing test conventions in this repo: `vi.spyOn(agent as any, "<privateMethod>")` to stub LLM calls, plain object literals for fixtures (no factory libraries).

---

### Task 1: Types — `DiscussionPoint`, `PodcastScript`, `ScriptRecord`, interface signatures

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/agents/SpeakerAgent.test.ts` (fixture helper)
- Modify: `src/services/ScriptService.test.ts` (fixture helper)

**Interfaces:**
- Produces: `DiscussionPoint { id: string; text: string; covered: boolean; coveredAtTurn?: number }`, `PodcastScript.discussionPoints: DiscussionPoint[]`, `ScriptRecord.discussionPoints: DiscussionPoint[]`, `IDirectorAgent.chooseNextSpeaker(...)` return type gains `requestSummary: boolean`, `ISpeakerAgent.speak(...)` gains optional `requestSummary?: boolean` 5th param.

- [ ] **Step 1: Add `DiscussionPoint` and update `PodcastScript`/`ScriptRecord` in `src/types/index.ts`**

Add this new interface directly above `export interface PodcastScript {` (around line 104):

```ts
export interface DiscussionPoint {
  id: string;
  text: string;
  covered: boolean;
  coveredAtTurn?: number;
}

export interface PodcastScript {
  id: string;
  title: string;
  description: string;
  speakers: Speaker[];
  speeches: Speech[];
  materials: PodcastMaterial[];
  discussionPoints: DiscussionPoint[];
  createdAt: Date;
  updatedAt: Date;
}
```

Update `ScriptRecord` (around line 161) to add the same field:

```ts
export interface ScriptRecord {
  id: string;
  title: string;
  description: string;
  speakerIds: string[];
  speechIds: string[];
  materialIds: string[];
  discussionPoints: DiscussionPoint[];
  createdAt: Date;
  updatedAt: Date;
}
```

- [ ] **Step 2: Update `IDirectorAgent` and `ISpeakerAgent` in `src/types/index.ts`**

Replace the `IDirectorAgent` interface (around line 331):

```ts
export interface IDirectorAgent {
  createPodcastPlan(script: PodcastScript): Promise<string>;
  chooseNextSpeaker(script: PodcastScript): Promise<{
    speaker: Speaker;
    direction: string;
    timeStatus: string;
    forceNearlyOutOfTime: boolean;
    requestSummary: boolean;
  }>;
}
```

Replace the `ISpeakerAgent` interface (around line 322):

```ts
export interface ISpeakerAgent {
  speak(
    script: PodcastScript,
    direction: string,
    timeStatus?: string,
    forceNearlyOutOfTime?: boolean,
    requestSummary?: boolean
  ): Promise<Speech>;
}
```

- [ ] **Step 3: Fix existing test fixtures that construct `PodcastScript` literals**

In `src/agents/SpeakerAgent.test.ts`, the `makeScript` helper (around line 29) builds a `PodcastScript` object literal missing the new required field. Add it:

```ts
function makeScript(
  speeches: PodcastScript["speeches"] = [],
  speakers: PodcastScript["speakers"] = [makeSpeaker("s1"), makeSpeaker("s2")]
): PodcastScript {
  return {
    id: "script-1",
    title: "Test Script",
    description: "A test script",
    speakers,
    speeches,
    materials: [],
    discussionPoints: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
```

In `src/services/ScriptService.test.ts`, the `makeScript` helper (around line 6) needs the same fix:

```ts
function makeScript(): PodcastScript {
  return {
    id: "script-1",
    title: "Test Script",
    description: "A test script",
    speakers: [],
    speeches: [],
    materials: [],
    discussionPoints: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
```

- [ ] **Step 4: Verify the project still compiles**

Run: `npx tsc --noEmit`
Expected: no errors (the rest of the codebase doesn't reference `discussionPoints` yet, so nothing else should break).

- [ ] **Step 5: Run the full test suite**

Run: `pnpm test`
Expected: all existing tests still PASS (only fixture literals changed, no behavior changed).

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/agents/SpeakerAgent.test.ts src/services/ScriptService.test.ts
git commit -m "feat: add DiscussionPoint type and thread it through PodcastScript/ScriptRecord"
```

---

### Task 2: `director-tools.ts` — `coveredPointIds` on `select_next_speaker`, new `create_podcast_plan` tool

**Files:**
- Modify: `src/agents/director-tools.ts`
- Create: `src/agents/director-tools.test.ts`

**Interfaces:**
- Consumes: `LlmTool`, `Speaker` from `../types` (unchanged).
- Produces: `SelectNextSpeakerInput.coveredPointIds?: string[]`, `CreatePodcastPlanInput { narrative: string; points: string[] }`, `toCreatePodcastPlanTool(): LlmTool`, `CREATE_PODCAST_PLAN_TOOL_NAME`.

- [ ] **Step 1: Write the failing tests**

Create `src/agents/director-tools.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toCreatePodcastPlanTool, toSelectNextSpeakerTool } from "./director-tools";
import { Speaker, VocalProviderName } from "../types";

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
    isExpert: false,
  };
}

describe("director-tools", () => {
  it("toSelectNextSpeakerTool includes an optional coveredPointIds array field", () => {
    const tool = toSelectNextSpeakerTool([makeSpeaker("s1")]);

    expect(tool.input_schema.properties.coveredPointIds).toEqual({
      type: "array",
      items: { type: "string" },
      description:
        "IDs of currently-open discussion points that the most recent speech(es) addressed. Omit or leave empty if none were covered.",
    });
    expect(tool.input_schema.required).toEqual(["speakerId", "direction"]);
  });

  it("toCreatePodcastPlanTool requires narrative and points", () => {
    const tool = toCreatePodcastPlanTool();

    expect(tool.input_schema.required).toEqual(["narrative", "points"]);
    expect(tool.input_schema.properties.points).toEqual({
      type: "array",
      items: { type: "string" },
      description:
        "3-8 concrete, discrete discussion points that must be covered during the episode, each a short phrase.",
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/agents/director-tools.test.ts`
Expected: FAIL — `toCreatePodcastPlanTool` is not exported, and `coveredPointIds` is undefined on the existing schema.

- [ ] **Step 3: Implement the changes in `src/agents/director-tools.ts`**

Replace the full file contents:

```ts
import { LlmTool, Speaker } from "../types";

export const SELECT_NEXT_SPEAKER_TOOL_NAME = "select_next_speaker";
export const CREATE_PODCAST_PLAN_TOOL_NAME = "create_podcast_plan";

export interface SelectNextSpeakerInput {
  speakerId: string;
  direction: string;
  coveredPointIds?: string[];
}

export function toSelectNextSpeakerTool(speakers: Speaker[]): LlmTool {
  return {
    name: SELECT_NEXT_SPEAKER_TOOL_NAME,
    description:
      "Choose which speaker should talk next and give them direction for their turn.",
    input_schema: {
      type: "object",
      properties: {
        speakerId: {
          type: "string",
          enum: speakers.map((speaker) => speaker.id),
          description: "The id of the speaker who should talk next.",
        },
        direction: {
          type: "string",
          description:
            "Clear, specific, conversational direction for what this speaker should say next.",
        },
        coveredPointIds: {
          type: "array",
          items: { type: "string" },
          description:
            "IDs of currently-open discussion points that the most recent speech(es) addressed. Omit or leave empty if none were covered.",
        },
      },
      required: ["speakerId", "direction"],
    },
  };
}

export interface CreatePodcastPlanInput {
  narrative: string;
  points: string[];
}

export function toCreatePodcastPlanTool(): LlmTool {
  return {
    name: CREATE_PODCAST_PLAN_TOOL_NAME,
    description:
      "Provide the podcast plan as a narrative description plus a list of discrete discussion points that must be covered.",
    input_schema: {
      type: "object",
      properties: {
        narrative: {
          type: "string",
          description:
            "A detailed prose description of how the conversation should flow: opening, segments, closing.",
        },
        points: {
          type: "array",
          items: { type: "string" },
          description:
            "3-8 concrete, discrete discussion points that must be covered during the episode, each a short phrase.",
        },
      },
      required: ["narrative", "points"],
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/agents/director-tools.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/agents/director-tools.ts src/agents/director-tools.test.ts
git commit -m "feat: add coveredPointIds and create_podcast_plan tool to director-tools"
```

---

### Task 3: `speaker-tools.ts` — new `SUMMARIZE` tool

**Files:**
- Modify: `src/agents/speaker-tools.ts`
- Modify: `src/agents/speaker-tools.test.ts`

**Interfaces:**
- Produces: `SpeakerAgentToolName.SUMMARIZE = "summarize"`, included in `toLlmTools()`'s default (unfiltered) set.

- [ ] **Step 1: Write the failing test**

Add to `src/agents/speaker-tools.test.ts` (inside the existing `describe("speaker-tools", ...)` block, after the CHALLENGE test):

```ts
  it("includes SUMMARIZE with the shared {message, style} schema", () => {
    const tools = toLlmTools();
    const summarize = tools.find(
      (tool) => tool.name === SpeakerAgentToolName.SUMMARIZE
    );

    expect(summarize).toBeDefined();
    expect(summarize?.input_schema.required).toEqual(["message", "style"]);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/agents/speaker-tools.test.ts`
Expected: FAIL — `SpeakerAgentToolName.SUMMARIZE` is `undefined`.

- [ ] **Step 3: Implement in `src/agents/speaker-tools.ts`**

Update the enum (around line 3):

```ts
export enum SpeakerAgentToolName {
  SPEAK = "speak",
  INTERJECT = "interject",
  ONE_LINER = "one_liner",
  FILLER_COMMENT = "filler_comment",
  QUOTE = "quote",
  SHORT_QUESTION = "short_question",
  NEARLY_OUT_OF_TIME = "nearly_out_of_time",
  CHALLENGE = "challenge",
  SUMMARIZE = "summarize",
}
```

Add a new entry to `SPEAKER_TOOL_DEFINITIONS`, immediately after the `CHALLENGE` entry (around line 76, before the closing `];`):

```ts
  {
    name: SpeakerAgentToolName.SUMMARIZE,
    toolDescription:
      "Deliver a compact recap that briefly touches each of several named discussion points, one short clause per point, instead of one idea per turn. Use only when directed to catch up on multiple remaining points at once.",
    styleDescription:
      "How to deliver the summary. Include pacing and tone. Example: 'Brisk, matter-of-fact pace, quick transitions between points'",
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/agents/speaker-tools.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/agents/speaker-tools.ts src/agents/speaker-tools.test.ts
git commit -m "feat: add SUMMARIZE speaker tool for compressed multi-point recaps"
```

---

### Task 4: `DirectorAgent.createPodcastPlan` — structured discussion points

**Files:**
- Modify: `src/agents/DirectorAgent.ts`
- Create: `src/agents/DirectorAgent.test.ts`

**Interfaces:**
- Consumes: `toCreatePodcastPlanTool`, `CreatePodcastPlanInput` from `./director-tools` (Task 2); `DiscussionPoint` from `../types` (Task 1).
- Produces: `DirectorAgent` gets a private `points: DiscussionPoint[]` field, populated by `createPodcastPlan()` and mirrored onto `script.discussionPoints`.

- [ ] **Step 1: Write the failing test**

Create `src/agents/DirectorAgent.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { DirectorAgent } from "./DirectorAgent";
import { PodcastScript, Speaker, VocalProviderName } from "../types";

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
    isExpert: false,
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

describe("DirectorAgent.createPodcastPlan", () => {
  it("assigns sequential ids to points and stores them on the script", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });
    vi.spyOn(agent as any, "callModelForToolInput").mockResolvedValue({
      narrative: "Open with intros, then dig in.",
      points: ["Point A", "Point B", "Point C"],
    });

    await agent.createPodcastPlan();

    expect(script.discussionPoints).toEqual([
      { id: "p1", text: "Point A", covered: false },
      { id: "p2", text: "Point B", covered: false },
      { id: "p3", text: "Point C", covered: false },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/agents/DirectorAgent.test.ts`
Expected: FAIL — `script.discussionPoints` stays `[]` because `createPodcastPlan` still uses `callModel` and never sets it.

- [ ] **Step 3: Implement in `src/agents/DirectorAgent.ts`**

Update the imports at the top of the file:

```ts
import { DiscussionPoint, IDirectorAgent, PodcastScript, Speaker } from '../types';
import { BaseAgent } from './BaseAgent';
import { logger } from '../utils/logger';
import {
  CreatePodcastPlanInput,
  SelectNextSpeakerInput,
  toCreatePodcastPlanTool,
  toSelectNextSpeakerTool,
} from './director-tools';
```

Add a `points` field alongside the existing private fields (around line 16):

```ts
  private turnsUsed = 0;
  private hasForcedTimeWarning = false;
  private points: DiscussionPoint[] = [];
```

Replace `createPodcastPlan()` (lines 29-68) with:

```ts
  async createPodcastPlan(): Promise<string> {
    try {
      this.logAgentAction('Creating podcast plan');

      const materialText = this.script.materials
        .map(material => `${material.title}: ${material.content}`)
        .join('\n\n');

      const messages = [
        {
          role: 'user' as const,
          content: `You are a podcast director. Create a plan for a podcast episode with the following details:

Title: ${this.script.title}
Description: ${this.script.description}
Duration: Approximately ${Math.round(this.maxDuration / 60)} minutes, across up to ${this.maxTurns} speaking turns
Speakers: ${this.script.speakers.map(s => s.name).join(', ')}

Available materials:
${materialText}

Create a detailed plan for how the conversation should flow, including:
1. Opening segment
2. Main discussion points
3. Key topics to cover
4. Closing segment

Keep it engaging and natural, with clear direction for each speaker.

Also provide a separate list of 3-8 concrete discussion points that must be covered during the episode — short, discrete phrases rather than full sentences, since they'll be tracked individually as the conversation progresses.`
        }
      ];

      const tools = [toCreatePodcastPlanTool()];
      const { narrative, points } = await this.callModelForToolInput<CreatePodcastPlanInput>(
        messages,
        tools,
        800
      );

      this.podcastPlan = narrative;
      this.points = points.map((text, index) => ({
        id: `p${index + 1}`,
        text,
        covered: false,
      }));
      this.script.discussionPoints = this.points;

      logger.info(
        `Podcast plan created successfully with ${this.points.length} discussion points`
      );

      return this.podcastPlan;
    } catch (error) {
      logger.error('Failed to create podcast plan:', error);
      throw error;
    }
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/agents/DirectorAgent.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `pnpm test && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/agents/DirectorAgent.ts src/agents/DirectorAgent.test.ts
git commit -m "feat: DirectorAgent.createPodcastPlan produces structured discussion points"
```

---

### Task 5: `DirectorAgent.chooseNextSpeaker` — coverage marking, velocity, `requestSummary`, logging

**Files:**
- Modify: `src/agents/DirectorAgent.ts`
- Modify: `src/agents/DirectorAgent.test.ts`

**Interfaces:**
- Consumes: `this.points: DiscussionPoint[]` (Task 4), `SelectNextSpeakerInput.coveredPointIds` (Task 2).
- Produces: `chooseNextSpeaker` return value gains `requestSummary: boolean`; new private methods `applyCoveredPoints`, `calculateVelocity`, `getVelocityNote`, `getOpenPointsSection`, `logVelocity` on `DirectorAgent`.

- [ ] **Step 1: Write the failing tests**

Add to `src/agents/DirectorAgent.test.ts` (after the existing `describe` block):

```ts
describe("DirectorAgent.chooseNextSpeaker coverage tracking", () => {
  it("marks points covered from coveredPointIds and reflects it on the next call's prompt", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });

    vi.spyOn(agent as any, "callModelForToolInput").mockResolvedValueOnce({
      narrative: "plan",
      points: ["Point A", "Point B"],
    });
    await agent.createPodcastPlan();

    const chooseSpy = vi.spyOn(agent as any, "callModelForToolInput");
    chooseSpy.mockResolvedValueOnce({
      speakerId: "s1",
      direction: "Talk about A",
      coveredPointIds: ["p1"],
    });

    await agent.chooseNextSpeaker(script);

    expect(script.discussionPoints.find((p) => p.id === "p1")?.covered).toBe(true);
    expect(script.discussionPoints.find((p) => p.id === "p2")?.covered).toBe(false);

    chooseSpy.mockResolvedValueOnce({
      speakerId: "s2",
      direction: "Talk about B",
      coveredPointIds: [],
    });

    await agent.chooseNextSpeaker(script);

    const prompt = (chooseSpy.mock.calls[1][0] as any)[0].content as string;
    expect(prompt).toContain("p2: Point B");
    expect(prompt).not.toContain("p1: Point A");
  });
});

describe("DirectorAgent velocity / pacing", () => {
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

    vi.spyOn(agent as any, "callModelForToolInput").mockResolvedValueOnce({
      narrative: "plan",
      points: ["Point A", "Point B", "Point C"],
    });
    await agent.createPodcastPlan();

    vi.spyOn(agent as any, "callModelForToolInput").mockResolvedValueOnce({
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

    vi.spyOn(agent as any, "callModelForToolInput").mockResolvedValueOnce({
      narrative: "plan",
      points: ["Point A"],
    });
    await agent.createPodcastPlan();

    vi.spyOn(agent as any, "callModelForToolInput").mockResolvedValueOnce({
      speakerId: "s1",
      direction: "keep going",
      coveredPointIds: [],
    });

    const result = await agent.chooseNextSpeaker(script);

    expect(result.requestSummary).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/agents/DirectorAgent.test.ts`
Expected: FAIL — `chooseNextSpeaker`'s return value has no `requestSummary` field yet, and the prompt doesn't list open points.

- [ ] **Step 3: Implement in `src/agents/DirectorAgent.ts`**

Replace `chooseNextSpeaker` (the method from the previous task's file state) with:

```ts
  async chooseNextSpeaker(script: PodcastScript): Promise<{
    speaker: Speaker;
    direction: string;
    timeStatus: string;
    forceNearlyOutOfTime: boolean;
    requestSummary: boolean;
  }> {
    try {
      this.logAgentAction('Choosing next speaker');

      this.turnsUsed++;
      const progress = this.calculateProgress(script);
      const wrapUpNote = this.getWrapUpNote(progress);
      const velocityBeforeThisTurn = this.calculateVelocity(script);
      const velocityNote = this.getVelocityNote(velocityBeforeThisTurn);
      const openPointsSection = this.getOpenPointsSection();

      // Force exactly one explicit "we're almost out of time" tool call the
      // first time the episode crosses into the almost-out-of-time band,
      // rather than just hoping the speaker picks it up from prose — a soft
      // suggestion was easy for the model to skip and then never revisit.
      const forceNearlyOutOfTime =
        progress >= 85 &&
        this.turnsUsed < this.maxTurns &&
        !this.hasForcedTimeWarning;
      if (forceNearlyOutOfTime) {
        this.hasForcedTimeWarning = true;
      }

      const history = this.getConversationHistory(script);
      const speakerDescriptions = script.speakers
        .map(
          (speaker) =>
            `- ${speaker.name} (id: ${speaker.id}, ${
              speaker.isExpert ? 'expert' : 'interviewer'
            }): ${speaker.personality}`
        )
        .join('\n');

      const messages = [
        {
          role: 'user' as const,
          content: `You are directing a podcast. Here's the current situation:

Podcast Plan: ${this.podcastPlan}

Progress: ${progress}% complete${openPointsSection}

Speakers:
${speakerDescriptions}

Conversation so far (each line tagged with the tool used to deliver it — "speak" is substantive content; "interject", "filler_comment", "one_liner", and "short_question" are brief reactions, not real answers or new points):
${history || '(nothing said yet — this is the opening of the episode)'}

Decide which speaker should talk next and give them clear, specific, conversational direction about what they should say. Don't mistake a brief reaction tag (interject/filler_comment/one_liner/short_question) for a substantive point — if the last speaker only reacted, direct the next speaker to actually answer or continue, not to react to the reaction. On the opening of the episode, this should usually be the interviewer. If the open discussion points list above shows points already addressed by recent turns, mark their ids in coveredPointIds.${this.getPacingNote(
            script
          )}${wrapUpNote}${velocityNote}`
        }
      ];

      const tools = [toSelectNextSpeakerTool(script.speakers)];
      const { speakerId, direction, coveredPointIds } =
        await this.callModelForToolInput<SelectNextSpeakerInput>(
          messages,
          tools,
          300
        );

      this.applyCoveredPoints(coveredPointIds);
      const velocityAfterThisTurn = this.calculateVelocity(script);
      this.logVelocity(velocityAfterThisTurn);
      const requestSummary =
        velocityAfterThisTurn.paceStatus === 'behind' &&
        velocityAfterThisTurn.openCount >= 2;

      const speaker = script.speakers.find((s) => s.id === speakerId);
      if (!speaker) {
        logger.warn(
          `Director chose unknown speakerId "${speakerId}"; falling back to alternating speaker`
        );
        return {
          speaker: this.fallbackSpeaker(script),
          direction,
          timeStatus: wrapUpNote,
          forceNearlyOutOfTime,
          requestSummary,
        };
      }

      logger.debug(`Director chose ${speaker.name}: ${direction}`);
      return {
        speaker,
        direction,
        timeStatus: wrapUpNote,
        forceNearlyOutOfTime,
        requestSummary,
      };
    } catch (error) {
      logger.error('Failed to choose next speaker:', error);
      throw error;
    }
  }

  private applyCoveredPoints(coveredPointIds?: string[]): void {
    if (!coveredPointIds || coveredPointIds.length === 0) {
      return;
    }
    for (const point of this.points) {
      if (coveredPointIds.includes(point.id) && !point.covered) {
        point.covered = true;
        point.coveredAtTurn = this.turnsUsed;
      }
    }
  }

  /**
   * Compares points-covered-per-minute against points-needed-per-minute to
   * finish the remaining open points within the remaining time budget.
   */
  private calculateVelocity(script: PodcastScript): {
    coveredCount: number;
    openCount: number;
    elapsedMinutes: number;
    remainingMinutes: number;
    paceStatus: 'ahead' | 'on-pace' | 'behind' | 'unknown';
  } {
    if (this.points.length === 0) {
      return {
        coveredCount: 0,
        openCount: 0,
        elapsedMinutes: 0,
        remainingMinutes: 0,
        paceStatus: 'unknown',
      };
    }

    const elapsedSeconds = this.estimateElapsedSeconds(script);
    const elapsedMinutes = elapsedSeconds / 60;
    const remainingMinutes = Math.max(
      (this.maxDuration - elapsedSeconds) / 60,
      0.1
    );
    const coveredCount = this.points.filter((point) => point.covered).length;
    const openCount = this.points.length - coveredCount;

    if (elapsedMinutes <= 0) {
      return {
        coveredCount,
        openCount,
        elapsedMinutes,
        remainingMinutes,
        paceStatus: 'unknown',
      };
    }

    const actualPace = coveredCount / Math.max(elapsedMinutes, 0.1);
    const neededPace = openCount / remainingMinutes;

    let paceStatus: 'ahead' | 'on-pace' | 'behind';
    if (actualPace < neededPace * 0.9) {
      paceStatus = 'behind';
    } else if (actualPace > neededPace * 1.25) {
      paceStatus = 'ahead';
    } else {
      paceStatus = 'on-pace';
    }

    return { coveredCount, openCount, elapsedMinutes, remainingMinutes, paceStatus };
  }

  private getVelocityNote(
    velocity: ReturnType<DirectorAgent['calculateVelocity']>
  ): string {
    if (velocity.paceStatus !== 'behind') {
      return '';
    }

    const openPoints = this.points.filter((point) => !point.covered);
    const openPointsList = openPoints
      .map((point) => `- ${point.id}: ${point.text}`)
      .join('\n');

    return ` The conversation is behind pace on discussion points — ${velocity.openCount} point(s) remain with about ${velocity.remainingMinutes.toFixed(
      1
    )} minutes left. Direct the next speaker to move faster and cover multiple remaining points concisely rather than dwelling on one:\n${openPointsList}`;
  }

  private getOpenPointsSection(): string {
    if (this.points.length === 0) {
      return '';
    }
    const openPoints = this.points.filter((point) => !point.covered);
    if (openPoints.length === 0) {
      return '\n\nAll discussion points have been covered.';
    }
    const list = openPoints
      .map((point) => `- ${point.id}: ${point.text}`)
      .join('\n');
    return `\n\nOpen discussion points (mark any addressed by the last speech(es) via coveredPointIds):\n${list}`;
  }

  private logVelocity(
    velocity: ReturnType<DirectorAgent['calculateVelocity']>
  ): void {
    if (this.points.length === 0) {
      return;
    }
    logger.info(
      `Discussion points: ${velocity.coveredCount}/${this.points.length} covered · ${velocity.elapsedMinutes.toFixed(
        1
      )}/${(this.maxDuration / 60).toFixed(1)} min elapsed · pace: ${velocity.paceStatus}`
    );
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/agents/DirectorAgent.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `pnpm test && npx tsc --noEmit`
Expected: all PASS, no type errors. (`ScriptService.ts` and `SpeakerAgent.ts` don't yet consume `requestSummary`, which is fine — it's an added, unused-so-far field on the return type until Tasks 6-7 wire it through.)

- [ ] **Step 6: Commit**

```bash
git add src/agents/DirectorAgent.ts src/agents/DirectorAgent.test.ts
git commit -m "feat: DirectorAgent tracks point coverage and computes points-per-minute velocity"
```

---

### Task 6: `SpeakerAgent` — force `SUMMARIZE` and raise token budget when `requestSummary` is true

**Files:**
- Modify: `src/agents/SpeakerAgent.ts`
- Modify: `src/agents/SpeakerAgent.test.ts`

**Interfaces:**
- Consumes: `SpeakerAgentToolName.SUMMARIZE` (Task 3), `ISpeakerAgent.speak(..., requestSummary?: boolean)` (Task 1).
- Produces: `SpeakerAgent.speak`/`generateSpeech` accept a 5th `requestSummary` param; `forceNearlyOutOfTime` still takes precedence over `requestSummary` when both are true.

- [ ] **Step 1: Write the failing tests**

Add to `src/agents/SpeakerAgent.test.ts` (after the existing `describe("SpeakerAgent expertise nudge", ...)` block):

```ts
describe("SpeakerAgent requestSummary", () => {
  it("forces the SUMMARIZE tool and raises the token budget when requestSummary is true", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1"));
    const spy = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.SUMMARIZE,
      message: "quick recap of a, b, and c",
      style: "brisk",
      stopReason: "stop",
    });

    await agent.speak(
      makeScript(),
      "catch up on remaining points",
      "",
      false,
      true
    );

    const offeredTools = spy.mock.calls[0][1] as { name: string }[];
    expect(offeredTools.map((tool) => tool.name)).toEqual([
      SpeakerAgentToolName.SUMMARIZE,
    ]);
    expect(spy.mock.calls[0][2]).toBe(180);
  });

  it("still forces NEARLY_OUT_OF_TIME over SUMMARIZE when both flags are true", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1"));
    const spy = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.NEARLY_OUT_OF_TIME,
      message: "we're almost out of time",
      style: "urgent",
      stopReason: "stop",
    });

    await agent.speak(makeScript(), "wrap up", "almost out of time", true, true);

    const offeredTools = spy.mock.calls[0][1] as { name: string }[];
    expect(offeredTools.map((tool) => tool.name)).toEqual([
      SpeakerAgentToolName.NEARLY_OUT_OF_TIME,
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/agents/SpeakerAgent.test.ts`
Expected: FAIL — `speak()` only accepts 4 params today and never offers `SUMMARIZE`.

- [ ] **Step 3: Implement in `src/agents/SpeakerAgent.ts`**

Add the new token-budget constant alongside the existing ones (around line 20-23):

```ts
  private static readonly SPEECH_MAX_TOKENS = 150;
  // Tight on purpose: interjections are meant to be 1-10 words, and a shared
  // budget with SPEAK-length turns let the model ramble well past that.
  private static readonly INTERJECTION_MAX_TOKENS = 40;
  // A recap has to touch several points in one turn, so it needs more room
  // than a normal single-idea SPEAK turn, but stays well short of a ramble.
  private static readonly SUMMARY_MAX_TOKENS = 180;
```

Update the `speak` method signature and its call to `generateSpeech` (around lines 33-54):

```ts
  async speak(
    script: PodcastScript,
    direction: string,
    timeStatus = "",
    forceNearlyOutOfTime = false,
    requestSummary = false
  ): Promise<Speech> {
    let attempts = 0;

    while (attempts < this.maxAttempts) {
      try {
        this.logAgentAction("Generating speech", {
          speaker: this.speaker.name,
          attempt: attempts + 1,
        });

        const { toolName, message, style, stopReason } =
          await this.generateSpeech(
            script,
            direction,
            timeStatus,
            forceNearlyOutOfTime,
            requestSummary
          );
```

(Leave the rest of `speak`'s body — the `speech` object construction, logging, and error handling — unchanged.)

Update `generateSpeech`'s signature and tool/token selection (around lines 132-200):

```ts
  private async generateSpeech(
    script: PodcastScript,
    direction: string,
    timeStatus: string,
    forceNearlyOutOfTime: boolean,
    requestSummary: boolean
  ): Promise<{
    toolName: SpeakerAgentToolName;
    message: string;
    style: string;
    stopReason: StopReason;
  }> {
```

(Leave the body up through the `messages` array construction unchanged — it doesn't need to change.) Then replace the final block of the method:

```ts
    const tools = forceNearlyOutOfTime
      ? toLlmTools([SpeakerAgentToolName.NEARLY_OUT_OF_TIME])
      : requestSummary
        ? toLlmTools([SpeakerAgentToolName.SUMMARIZE])
        : toLlmTools(isSolo ? SOLO_TOOLS : undefined);

    const maxTokens =
      requestSummary && !forceNearlyOutOfTime
        ? SpeakerAgent.SUMMARY_MAX_TOKENS
        : SpeakerAgent.SPEECH_MAX_TOKENS;

    const result = await this.callModelWithTools(messages, tools, maxTokens);

    return {
      toolName: result.toolName as SpeakerAgentToolName,
      message: result.message,
      style: result.style,
      stopReason: result.stopReason,
    };
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/agents/SpeakerAgent.test.ts`
Expected: PASS (all tests, including the 2 new ones)

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `pnpm test && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/agents/SpeakerAgent.ts src/agents/SpeakerAgent.test.ts
git commit -m "feat: SpeakerAgent forces SUMMARIZE and raises token budget on requestSummary"
```

---

### Task 7: `ScriptService` — thread `requestSummary`, persist `discussionPoints`, log uncovered points

**Files:**
- Modify: `src/services/ScriptService.ts`
- Modify: `src/services/ScriptService.test.ts`

**Interfaces:**
- Consumes: `chooseNextSpeaker`'s `requestSummary` (Task 5), `SpeakerAgent.speak`'s 5th param (Task 6), `PodcastScript.discussionPoints`/`ScriptRecord.discussionPoints` (Task 1).
- Produces: new private `ScriptService.logUncoveredPoints(script: PodcastScript): void`.

- [ ] **Step 1: Write the failing tests**

Add to `src/services/ScriptService.test.ts` (after the existing `describe("ScriptService stopReason persistence", ...)` block; the file already imports `describe`, `expect`, `it`, `vi`, `ScriptService`, `SpeakerAgentToolName`, `VocalProviderName`, `PodcastScript` — add `logger` and `DiscussionPoint`):

```ts
import { logger } from "../utils/logger";
```

Also extend the `makeService` helper (around line 19) to accept a `scriptRepository` override, matching the pattern already used for the other repositories:

```ts
function makeService(overrides: {
  scriptRepository?: any;
  speechRepository?: any;
  speakerRepository?: any;
  materialRepository?: any;
  voiceRepository?: any;
}) {
  return new ScriptService(
    overrides.scriptRepository ?? ({} as any),
    overrides.speakerRepository ?? ({} as any),
    overrides.materialRepository ?? ({} as any),
    overrides.voiceRepository ?? ({} as any),
    overrides.speechRepository ?? ({} as any)
  );
}
```

```ts
describe("ScriptService.logUncoveredPoints", () => {
  it("warns listing every point still not covered", () => {
    const service = makeService({});
    const script = makeScript();
    script.discussionPoints = [
      { id: "p1", text: "Point A", covered: true, coveredAtTurn: 1 },
      { id: "p2", text: "Point B", covered: false },
      { id: "p3", text: "Point C", covered: false },
    ];
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    (service as any).logUncoveredPoints(script);

    expect(warnSpy).toHaveBeenCalledWith(
      "2 discussion point(s) never covered: p2 (Point B), p3 (Point C)"
    );
    warnSpy.mockRestore();
  });

  it("does not warn when every point is covered", () => {
    const service = makeService({});
    const script = makeScript();
    script.discussionPoints = [
      { id: "p1", text: "Point A", covered: true, coveredAtTurn: 1 },
    ];
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    (service as any).logUncoveredPoints(script);

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("ScriptService discussionPoints persistence", () => {
  it("saveScript includes discussionPoints in the created record", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "record-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const service = makeService({ scriptRepository: { create } });
    const script = makeScript();
    script.discussionPoints = [
      { id: "p1", text: "Point A", covered: false },
    ];

    await (service as any).saveScript(script);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        discussionPoints: [{ id: "p1", text: "Point A", covered: false }],
      })
    );
  });

  it("loadScriptFromRecord reads discussionPoints back, defaulting to [] when absent", async () => {
    const speakerRepository = { getById: vi.fn() };
    const materialRepository = { getById: vi.fn() };
    const speechRepository = { getById: vi.fn() };
    const service = makeService({
      speakerRepository,
      materialRepository,
      speechRepository,
    });

    const withPoints = await (service as any).loadScriptFromRecord({
      id: "s1",
      title: "T",
      description: "D",
      speakerIds: [],
      speechIds: [],
      materialIds: [],
      discussionPoints: [{ id: "p1", text: "Point A", covered: true }],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(withPoints.discussionPoints).toEqual([
      { id: "p1", text: "Point A", covered: true },
    ]);

    const withoutPoints = await (service as any).loadScriptFromRecord({
      id: "s2",
      title: "T",
      description: "D",
      speakerIds: [],
      speechIds: [],
      materialIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(withoutPoints.discussionPoints).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/ScriptService.test.ts`
Expected: FAIL — `logUncoveredPoints` doesn't exist; `saveScript`'s record omits `discussionPoints`; `loadScriptFromRecord`'s result omits `discussionPoints`.

- [ ] **Step 3: Implement in `src/services/ScriptService.ts`**

Add `discussionPoints: []` to the initial script literal in `generateScript` (around line 40):

```ts
      const script: PodcastScript = {
        id: "",
        title: params.title,
        description: params.description,
        speakers,
        speeches: [],
        materials,
        discussionPoints: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
```

Update `generateScriptContent` to destructure and thread `requestSummary`, and log uncovered points at the end (around lines 185-229):

```ts
  private async generateScriptContent(
    script: PodcastScript,
    params: GenerateScriptParams
  ): Promise<void> {
    const directorAgent = new DirectorAgent(script, {
      maxTurns: params.maxTurns,
      maxDuration: params.maxDuration,
    });
    await directorAgent.createPodcastPlan();

    for (let turn = 0; turn < params.maxTurns; turn++) {
      const { speaker, direction, timeStatus, forceNearlyOutOfTime, requestSummary } =
        await directorAgent.chooseNextSpeaker(script);
      const speakerAgent = new SpeakerAgent(speaker);

      const speech = await speakerAgent.speak(
        script,
        direction,
        timeStatus,
        forceNearlyOutOfTime,
        requestSummary
      );
      await this.persistSpeech(script, speech);

      // If that turn ran long — or was cut off by the token limit — let a
      // different speaker chime in with a quick reaction before the director
      // picks the next real turn — real overlap instead of relying on the
      // speaker to self-select a short tool. Skip on the final turn so the
      // closing statement is the last thing said, not a context-blind reaction.
      const isFinalTurn = turn === params.maxTurns - 1;
      if (
        !isFinalTurn &&
        shouldInterject(speech, script.speakers.length, Math.random())
      ) {
        const eligibleInterjectors = script.speakers.filter(
          (s) => s.id !== speaker.id
        );
        const interjector =
          eligibleInterjectors[
            Math.floor(Math.random() * eligibleInterjectors.length)
          ];
        const interjectionAgent = new SpeakerAgent(interjector);
        const interjection = await interjectionAgent.interject(script);
        await this.persistSpeech(script, interjection);
      }
    }

    this.logUncoveredPoints(script);
  }

  private logUncoveredPoints(script: PodcastScript): void {
    const uncovered = (script.discussionPoints ?? []).filter(
      (point) => !point.covered
    );
    if (uncovered.length === 0) {
      return;
    }
    logger.warn(
      `${uncovered.length} discussion point(s) never covered: ${uncovered
        .map((point) => `${point.id} (${point.text})`)
        .join(", ")}`
    );
  }
```

Update `saveScript` to persist `discussionPoints` (around lines 299-312):

```ts
  private async saveScript(script: PodcastScript): Promise<void> {
    const record = {
      title: script.title,
      description: script.description,
      speakerIds: script.speakers.map((s) => s.id),
      speechIds: script.speeches.map((s) => s.id),
      materialIds: script.materials.map((m) => m.id),
      discussionPoints: script.discussionPoints ?? [],
    };

    const created = await this.scriptRepository.create(record);
    script.id = created.id;
    script.createdAt = created.createdAt;
    script.updatedAt = created.updatedAt;
  }
```

Update `loadScriptFromRecord`'s return value (around lines 287-296):

```ts
    return {
      id: record.id,
      title: record.title,
      description: record.description,
      speakers,
      speeches,
      materials,
      discussionPoints: record.discussionPoints ?? [],
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
    };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/services/ScriptService.test.ts`
Expected: PASS (all tests, including the 4 new ones)

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `pnpm test && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/services/ScriptService.ts src/services/ScriptService.test.ts
git commit -m "feat: ScriptService threads requestSummary, persists discussionPoints, logs uncovered points"
```

---

### Task 8: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the complete test suite**

Run: `pnpm test`
Expected: all tests PASS across every file touched in Tasks 1-7.

- [ ] **Step 2: Full typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: compiles cleanly to `dist/`.

- [ ] **Step 4: Manual smoke check (optional but recommended)**

Run a real script generation (`pnpm dev script generate ...` with a short `maxDuration`/`maxTurns`, per this repo's existing CLI usage) and confirm in the console output:
- An `INFO` line reads `Podcast plan created successfully with N discussion points` (N between 3-8).
- Per-turn `INFO` lines read `Discussion points: X/N covered · ... min elapsed · pace: ...`.
- If the episode runs out of turns with points still open, a final `WARN` line lists them.
