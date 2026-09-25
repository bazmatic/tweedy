import "dotenv/config";
import { describe, expect, it, vi } from "vitest";
import {
  AudienceValue,
  EditorialMove,
  EnergyLevel,
  Speech,
  VocalProviderName,
} from "../types";
import { JudgmentRunner } from "../services/JudgmentRunner";
import { JudgmentRecord } from "../services/JudgmentLog";
import { parseJudgmentModes } from "../services/judgment-modes";
import { TypeSafeJudgmentProvider } from "../providers/TypeSafeJudgmentProvider";
import { TurnReviewerAgent } from "./TurnReviewerAgent";

// Live check: the reviewer's real prompt, judged by the real TypeSafe API in
// "on" mode. Only term extraction / rewrite LLM calls are stubbed. Skipped
// unless TYPESAFE_API_KEY is set.
const { records } = vi.hoisted(() => ({ records: [] as JudgmentRecord[] }));
vi.mock("../services/judgment-runtime", () => ({
  getJudgmentRunner: () =>
    new JudgmentRunner(parseJudgmentModes("turn-review=on"), {
      append: async (r: JudgmentRecord) => void records.push(r),
      readAll: async () => records,
    }),
  getJudgmentProvider: () => new TypeSafeJudgmentProvider({ timeoutMs: 20000 }),
}));

const voice = {
  id: "v1",
  name: "Voice",
  description: "",
  provider: VocalProviderName.ElevenLabs,
  providerId: "voice",
  settings: {},
};
const ada = { id: "s1", slug: "ada", name: "Ada", personality: "curious host", voice, voiceStyle: "natural" };
const ben = { id: "s2", slug: "ben", name: "Ben", personality: "space historian", voice, voiceStyle: "measured" };

const said = (speaker: typeof ada, message: string): Speech => ({
  id: message.slice(0, 8),
  speaker,
  message,
  instructions: "",
  voice,
  voiceStyle: speaker.voiceStyle,
  timestamp: new Date(),
});

const history = [
  said(ada, "Welcome back. Today we're talking about Apollo 13, the 1970 Moon mission that went badly wrong."),
  said(ben, "Two days out, an oxygen tank in the service module exploded, and the crew lost most of their power and oxygen."),
  said(ada, "So how did they keep breathing?"),
];

const brief = {
  speakerId: "s2",
  goal: "Explain how the crew improvised a fix for rising carbon dioxide.",
  move: EditorialMove.Explain,
  cardIds: ["c1"],
  audienceValue: AudienceValue.Understanding,
  desiredEnergy: EnergyLevel.Reflective,
};
const cards = [
  {
    id: "c1",
    kind: "fact",
    content:
      "Mission control devised a way to fit the command module's square CO2 filters into the lunar module's round sockets using duct tape, plastic bags and cardboard.",
  } as any,
];

describe.skipIf(!process.env.TYPESAFE_API_KEY)(
  "TurnReviewerAgent + TypeSafe turn review (live)",
  () => {
    async function review(message: string) {
      const agent = new TurnReviewerAgent();
      vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValue({
        introducedTerms: [],
        message: "(rewrite)",
      });
      const before = records.length;
      const result = await agent.review(
        said(ben, message),
        brief,
        cards,
        history,
        undefined,
        undefined,
        undefined,
        [ada, ben]
      );
      return { result, detail: records[before]?.typesafeDetail };
    }

    it("accepts a good turn and rejects clear defects", async () => {
      const good = await review(
        "Carbon dioxide was building up, and the lunar module's filters were round while the spares were square. So mission control worked out a way to jam the square filters in with duct tape, plastic bags and cardboard, and it worked."
      );
      const invented = await review(
        "Thanks, Gene — great question. Carbon dioxide was building up, so they taped square filters into round sockets."
      );
      const repeated = await review(
        "Well, two days out, an oxygen tank in the service module exploded, and they lost most of their power and oxygen."
      );
      const jargon = await review(
        "The LiOH canisters' geometry mismatch meant they had to rig an adaptor for the LM ECS, and it held."
      );

      console.log("turn review details:", JSON.stringify({
        good: good.detail,
        invented: invented.detail,
        repeated: repeated.detail,
        jargon: jargon.detail,
      }));
      expect(good.result.accepted).toBe(true);
      expect(good.result.introducedCardIds).toEqual(["c1"]);
      expect(invented.result.accepted).toBe(false);
      expect(repeated.result.accepted).toBe(false);
      expect(repeated.result.addsVariety).toBe(false);
      expect(jargon.result.accepted).toBe(false);
      expect(jargon.result.audienceAccessible).toBe(false);
    }, 60000);
  }
);
