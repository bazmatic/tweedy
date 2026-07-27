import { describe, expect, it, vi } from "vitest";
import { verifyCoveredPointClaims } from "./CoverageVerifier";
import { DiscussionPoint } from "../types";

function makePoint(id: string, text: string): DiscussionPoint {
  return { id, text, covered: false };
}

describe("verifyCoveredPointClaims", () => {
  it("returns the confirmed ids from the model call, unmutated", async () => {
    const points = [makePoint("p1", "CO2 scrubber duct-tape hack"), makePoint("p2", "Oxygen tank explosion")];
    const callModel = vi.fn().mockResolvedValue({ confirmedPointIds: ["p2"] });
    const result = await verifyCoveredPointClaims(callModel, "some history", points);
    expect(result).toEqual(["p2"]);
    expect(points[0].covered).toBe(false);
    expect(points[1].covered).toBe(false);
  });

  it("returns an empty list when the model call fails", async () => {
    const points = [makePoint("p1", "Some point")];
    const callModel = vi.fn().mockRejectedValue(new Error("model unavailable"));
    const result = await verifyCoveredPointClaims(callModel, "some history", points);
    expect(result).toEqual([]);
  });

  it("returns an empty list without calling the model when there are no candidate points", async () => {
    const callModel = vi.fn();
    const result = await verifyCoveredPointClaims(callModel, "some history", []);
    expect(result).toEqual([]);
    expect(callModel).not.toHaveBeenCalled();
  });
});
