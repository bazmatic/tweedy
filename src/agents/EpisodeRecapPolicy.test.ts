import { describe, expect, it } from "vitest";
import { EpisodeRecapPolicy } from "./EpisodeRecapPolicy";

const policy = new EpisodeRecapPolicy();

describe("EpisodeRecapPolicy", () => {
  it("returns empty when no points are covered", () => {
    expect(
      policy.buildRecap({ discussionPoints: [], speeches: [] } as any)
    ).toBe("");
  });

  it("lists only covered points no longer visible in the recent window", () => {
    const script = {
      speeches: new Array(15).fill(null).map((_, i) => ({ message: `m${i}` })),
      discussionPoints: [
        { id: "p1", text: "account model differences", covered: true, coveredAtTurn: 2 },
        { id: "p2", text: "local fee markets", covered: true, coveredAtTurn: 14 },
        { id: "p3", text: "PDAs", covered: false },
      ],
    } as any;
    const recap = policy.buildRecap(script);
    expect(recap).toContain("account model differences");
    expect(recap).not.toContain("local fee markets"); // still in recent window
    expect(recap).not.toContain("PDAs"); // not yet covered
  });
});
