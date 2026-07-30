import {
  ISpeechRepository,
  PodcastScript,
  Speech,
} from "../types";
import {
  ClaimEditorialGate,
  DirectorAgent,
  EpisodeAuditAgent,
  SpeechRevisionPolicy,
} from "../agents";
import { logger } from "../utils/logger";

export class EpisodeRepairService {
  constructor(
    private readonly speechRepository: ISpeechRepository,
    private readonly auditAgent = new EpisodeAuditAgent(),
    private readonly claimGate = new ClaimEditorialGate(),
    private readonly revisionPolicy = new SpeechRevisionPolicy()
  ) {}

  async auditAndRepair(
    script: PodcastScript,
    maxDurationSeconds: number,
    director: Pick<DirectorAgent, "reviewSpeech">
  ): Promise<void> {
    const issues = await this.auditAgent.audit(script, maxDurationSeconds);
    const repairedSpeechIds: string[] = [];
    const unresolvedIssueIds: string[] = [];
    const originalsBySpeechId = new Map<string, Speech>();
    const repairedIssueBySpeechId = new Map<string, string>();
    const ordered = issues.sort(
      (a, b) =>
        script.speeches.findIndex((speech) => speech.id === a.speechId) -
        script.speeches.findIndex((speech) => speech.id === b.speechId)
    );

    for (const issue of ordered) {
      const index = script.speeches.findIndex(
        (speech) => speech.id === issue.speechId
      );
      if (index < 0) continue;
      const original = script.speeches[index];
      try {
        const message = await this.auditAgent.rewrite(
          issue,
          original,
          script.speeches.slice(Math.max(0, index - 6), index),
          script.speeches.slice(index + 1, index + 3)
        );
        if (
          !this.revisionPolicy.isUsable(
            message,
            original.tool === "closing_statement"
          )
        ) {
          unresolvedIssueIds.push(issue.id);
          continue;
        }
        const candidate: Speech = { ...original, message };
        const reviewed = await director.reviewSpeech(
          candidate,
          original.turnBrief?.goal ?? original.instructions,
          original.turnBrief,
          script.editorialCards ?? [],
          script.speeches.slice(0, index)
        );
        if (reviewed.review?.accepted === false) {
          unresolvedIssueIds.push(issue.id);
          continue;
        }
        const historicalScript: PodcastScript = {
          ...script,
          speeches: script.speeches.slice(0, index),
        };
        const gate = await this.claimGate.evaluate(
          reviewed,
          historicalScript
        );
        if (!gate.accepted) {
          unresolvedIssueIds.push(issue.id);
          continue;
        }
        const projectedScript: PodcastScript = {
          ...script,
          speeches: script.speeches.map((item, speechIndex) =>
            speechIndex === index ? reviewed : item
          ),
        };
        const verificationIssues = await this.auditAgent.audit(
          projectedScript,
          maxDurationSeconds
        );
        const nextSpeechId = script.speeches[index + 1]?.id;
        if (
          verificationIssues.some(
            (candidateIssue) =>
              candidateIssue.speechId === original.id ||
              candidateIssue.speechId === nextSpeechId
          )
        ) {
          unresolvedIssueIds.push(issue.id);
          continue;
        }

        const updated = await this.speechRepository.update(original.id, {
          message: reviewed.message,
          review: reviewed.review,
        });
        if (!updated) {
          unresolvedIssueIds.push(issue.id);
          continue;
        }
        script.speeches[index] = reviewed;
        repairedSpeechIds.push(original.id);
        originalsBySpeechId.set(original.id, original);
        repairedIssueBySpeechId.set(original.id, issue.id);
      } catch (error) {
        logger.warn(`Failed to repair episode issue ${issue.id}`, error);
        unresolvedIssueIds.push(issue.id);
      }
    }

    if (repairedSpeechIds.length > 0) {
      const finalIssues = await this.auditAgent.audit(
        script,
        maxDurationSeconds
      );
      for (const issue of finalIssues) {
        const original = originalsBySpeechId.get(issue.speechId);
        if (!original) {
          if (!unresolvedIssueIds.includes(issue.id)) {
            unresolvedIssueIds.push(issue.id);
          }
          continue;
        }
        try {
          const rolledBack = await this.speechRepository.update(original.id, {
            message: original.message,
            review: original.review,
          });
          if (rolledBack) {
            const index = script.speeches.findIndex(
              (speech) => speech.id === original.id
            );
            if (index >= 0) script.speeches[index] = original;
            const repairedIndex = repairedSpeechIds.indexOf(original.id);
            if (repairedIndex >= 0) repairedSpeechIds.splice(repairedIndex, 1);
          }
        } catch (error) {
          logger.warn(
            `Failed to roll back repaired speech ${original.id}`,
            error
          );
        }
        const originalIssueId =
          repairedIssueBySpeechId.get(original.id) ?? issue.id;
        if (!unresolvedIssueIds.includes(originalIssueId)) {
          unresolvedIssueIds.push(originalIssueId);
        }
      }
    }

    script.productionOutcome = {
      status:
        script.discussionPoints.some((point) => point.omitted)
          ? "complete_with_omissions"
          : "complete",
      completionReason:
        script.productionOutcome?.completionReason ?? "production_completed",
      omittedPointIds: script.discussionPoints
        .filter((point) => point.omitted)
        .map((point) => point.id),
      ...script.productionOutcome,
      audit: {
        inspected: true,
        repairedSpeechIds,
        unresolvedIssueIds,
      },
    };
  }
}
