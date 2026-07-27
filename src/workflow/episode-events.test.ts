import { describe, expect, it } from "vitest";
import { EpisodeEventSchema } from "./episode-events";

describe("EpisodeEventSchema", () => {
  it("parses one representative payload per event type", () => {
    const timestamp = "2026-07-27T00:00:00.000Z";
    const events = [
      { type: "EPISODE_INITIALISED", timestamp },
      { type: "MATERIALS_PREPARED", timestamp },
      { type: "ROLES_ASSIGNED", timestamp, assignments: { "speaker-1": "host" } },
      { type: "PLAN_CREATED", timestamp },
      { type: "OPENING_ADVANCED", timestamp, isFinalOpeningTurn: false },
      { type: "TURN_DIRECTED", timestamp, speakerId: "speaker-1", direction: "open with a hook", kind: "speech" },
      { type: "TURN_GENERATED", timestamp, message: "hello", stopReason: "stop" },
      { type: "TURN_REVIEWED", timestamp, approved: true, notes: "fine" },
      { type: "TURN_REJECTED", timestamp, reason: "too repetitive" },
      {
        type: "TURN_ACCEPTED",
        timestamp,
        speechId: "speech-1",
        durationSeconds: 12.5,
        coveredDiscussionPointIds: ["dp-1"],
        coveredConversationBeatIds: [],
      },
      { type: "INTERJECTION_REQUESTED", timestamp, speakerId: "speaker-2", direction: "push back" },
      { type: "CLOSING_REQUESTED", timestamp, reason: "duration limit reached" },
      { type: "EPISODE_COMPLETED", timestamp },
      { type: "WORKFLOW_WARNING_RECORDED", timestamp, message: "reviewer failed open" },
    ];

    for (const event of events) {
      expect(() => EpisodeEventSchema.parse(event), event.type).not.toThrow();
    }
  });

  it("rejects an unknown event type", () => {
    expect(() =>
      EpisodeEventSchema.parse({ type: "NOT_A_REAL_EVENT", timestamp: "2026-07-27T00:00:00.000Z" })
    ).toThrow();
  });
});
