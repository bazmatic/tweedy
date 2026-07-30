import { PodcastScript, Speech } from "../types";
import { ModelTask } from "../providers/ModelRoutingPolicy";
import { logger } from "../utils/logger";
import { BaseAgent } from "./BaseAgent";
import {
  EpisodeAuditInput,
  EpisodeAuditIssue,
  episodeAuditSchema,
  RewriteRejectedTurnInput,
  rewriteRejectedTurnSchema,
} from "./editorial-schemas";

const MAX_AUDIT_TOKENS = 450;
const MAX_REWRITE_TOKENS = 220;
const MAX_ISSUES = 3;

export class EpisodeAuditAgent extends BaseAgent {
  async audit(
    script: PodcastScript,
    maxDurationSeconds: number
  ): Promise<EpisodeAuditIssue[]> {
    const deterministic = this.deterministicIssues(
      script,
      maxDurationSeconds
    );
    if (deterministic.length >= MAX_ISSUES) {
      return deterministic.slice(0, MAX_ISSUES);
    }
    const transcript = script.speeches
      .map(
        (speech) =>
          `[${speech.id}] ${speech.speaker.name}: ${speech.message}`
      )
      .join("\n");
    try {
      const result = await this.callModelForStructuredOutput<EpisodeAuditInput>(
        ModelTask.TurnReview,
        [
          {
            role: "user",
            content: `Audit this completed podcast as a listener who knows only the spoken transcript.

Transcript:
${transcript}

Report only local defects repairable by rewriting one existing turn: missing audible context or antecedents, a consequence spoken before its setup, substantial repetition, speaker-role inversion, broken adjacent continuity, an inaccurate closing summary, implausible duration language, or malformed speech. Do not report a planned topic merely because it was omitted. Do not propose rewrites. Return at most ${MAX_ISSUES} issues, each with the exact bracketed speechId, one category, and a plain reason fragment of at most 12 words. Prefer the earliest turn responsible for a problem.`,
          },
        ],
        episodeAuditSchema,
        MAX_AUDIT_TOKENS
      );
      const validIds = new Set(script.speeches.map((speech) => speech.id));
      const combined = [...deterministic, ...result.issues]
        .filter((issue) => validIds.has(issue.speechId))
        .map((issue) => ({
          ...issue,
          id: `${issue.category}:${issue.speechId}`,
        }));
      return Array.from(
        new Map(combined.map((issue) => [issue.id, issue])).values()
      ).slice(0, MAX_ISSUES);
    } catch (error) {
      logger.warn(
        "Episode audit model unavailable; using deterministic findings only",
        error
      );
      return deterministic.slice(0, MAX_ISSUES);
    }
  }

  async rewrite(
    issue: EpisodeAuditIssue,
    speech: Speech,
    preceding: Speech[],
    following: Speech[]
  ): Promise<string> {
    const originalWords = speech.message.trim().split(/\s+/).length;
    const maxWords = Math.max(12, Math.min(90, originalWords + 12));
    const context = [
      ...preceding.map((item) => `${item.speaker.name}: ${item.message}`),
      `[TARGET] ${speech.speaker.name}: ${speech.message}`,
      ...following.map((item) => `${item.speaker.name}: ${item.message}`),
    ].join("\n");
    const result =
      await this.callModelForStructuredOutput<RewriteRejectedTurnInput>(
        ModelTask.TurnReview,
        [
          {
            role: "user",
            content: `Repair one local defect in this podcast turn.

Defect: ${issue.category} — ${issue.reason}
Original editorial goal: ${speech.turnBrief?.goal ?? speech.instructions}
Speaker: ${speech.speaker.name}
Local transcript:
${context}

Rewrite only the TARGET turn. Preserve its intended factual contribution, speaker voice, and continuity with both sides. Do not add an omitted topic or facts unavailable at this point. Return one complete spoken line of at most ${maxWords} words, with no analysis, labels, markdown, citations, or stage directions.`,
          },
        ],
        rewriteRejectedTurnSchema,
        MAX_REWRITE_TOKENS
      );
    return result.message.trim();
  }

  private deterministicIssues(
    script: PodcastScript,
    maxDurationSeconds: number
  ): EpisodeAuditIssue[] {
    const issues: EpisodeAuditIssue[] = [];
    for (const speech of script.speeches) {
      if (
        maxDurationSeconds < 30 * 60 &&
        /\b(?:spending|joining us for)\s+(?:this|the)\s+hour\b/i.test(
          speech.message
        )
      ) {
        issues.push({
          id: `duration_language:${speech.id}`,
          speechId: speech.id,
          category: "duration_language",
          reason: "Turn calls a short episode an hour",
        });
      }
      if (/(?:\.\.\.\s*uh\b|\b(?:undefined|null)\b)/i.test(speech.message)) {
        issues.push({
          id: `malformed_speech:${speech.id}`,
          speechId: speech.id,
          category: "malformed_speech",
          reason: "Turn contains accidental model debris",
        });
      }
      if (issues.length >= MAX_ISSUES) break;
    }
    return issues;
  }
}
