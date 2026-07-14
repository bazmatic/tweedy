import { SpeakerAgentToolName } from "../agents/speaker-tools";
import {
  EditableScriptDocument,
  PlannedScriptTurn,
  PodcastScript,
  ScriptEditPlan,
  ScriptEditSummary,
  ScriptEditTurnAction,
} from "../types";

export class ScriptEditValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptEditValidationError";
  }
}

export function hasScriptEditChanges(summary: ScriptEditSummary): boolean {
  return (
    summary.added > 0 ||
    summary.removed > 0 ||
    summary.edited > 0 ||
    summary.reordered
  );
}

/** Validates an editable document against its source script and plans changes. */
export class ScriptEditPlanner {
  plan(
    script: PodcastScript,
    document: EditableScriptDocument
  ): ScriptEditPlan {
    this.validateDocumentIdentity(script, document);

    const existingById = new Map(
      script.speeches.map((speech) => [speech.id, speech])
    );
    const speakersBySlug = new Map(
      script.speakers.map((speaker) => [speaker.slug, speaker])
    );
    const turns: PlannedScriptTurn[] = [];
    let added = 0;
    let edited = 0;
    let unchanged = 0;

    for (const turn of document.turns) {
      const speaker = speakersBySlug.get(turn.speakerSlug);
      if (!speaker) {
        throw new ScriptEditValidationError(
          `Unknown speaker slug "${turn.speakerSlug}" for script ${script.id}.`
        );
      }

      if (!turn.sourceId) {
        // `@id: new` deliberately has no stable identity until the plan is
        // applied and the repository assigns the new speech record an ID.
        added++;
        turns.push({
          ...turn,
          mode: turn.mode ?? SpeakerAgentToolName.SPEAK,
          action: ScriptEditTurnAction.Add,
        });
        continue;
      }

      const existing = existingById.get(turn.sourceId);
      if (!existing) {
        throw new ScriptEditValidationError(
          `Turn id ${turn.sourceId} does not belong to script ${script.id}.`
        );
      }
      if (existing.speaker.slug !== turn.speakerSlug) {
        // A human may rewrite what was said, but an existing speech record
        // cannot be reassigned: its persisted speaker and voice belong together.
        throw new ScriptEditValidationError(
          `Turn ${turn.sourceId} belongs to ${existing.speaker.slug}; changing its speaker is not supported.`
        );
      }

      const mode = turn.mode ?? existing.tool ?? SpeakerAgentToolName.SPEAK;
      // Formatting whitespace at the edges is not a material script edit. The
      // formatter normalises it on export, so comparing trimmed text also makes
      // an immediate export/import round trip a no-op.
      const isEdited =
        existing.message.trim() !== turn.message.trim() ||
        (existing.tool ?? SpeakerAgentToolName.SPEAK) !== mode;
      if (isEdited) edited++;
      else unchanged++;
      turns.push({
        ...turn,
        mode,
        action: isEdited
          ? ScriptEditTurnAction.Replace
          : ScriptEditTurnAction.Reuse,
      });
    }

    // Omission is the deletion mechanism: any original ID absent from the
    // edited document is removed from the script's ordered speech manifest.
    const retainedIds = new Set(
      document.turns.flatMap((turn) => (turn.sourceId ? [turn.sourceId] : []))
    );
    const removed = script.speeches.filter(
      (speech) => !retainedIds.has(speech.id)
    ).length;
    // Compare only retained turns. Added turns have no source identity and
    // removed turns cannot be reordered, so neither should affect this flag.
    const originalRetainedOrder = script.speeches
      .map((speech) => speech.id)
      .filter((id) => retainedIds.has(id));
    const editedRetainedOrder = document.turns.flatMap((turn) =>
      turn.sourceId ? [turn.sourceId] : []
    );
    // Speech IDs cannot contain NUL, making it an unambiguous list separator.
    const reordered =
      originalRetainedOrder.join("\u0000") !==
      editedRetainedOrder.join("\u0000");
    const summary: ScriptEditSummary = {
      added,
      removed,
      edited,
      unchanged,
      reordered,
    };

    return {
      scriptId: script.id,
      expectedRevision: document.revision,
      turns,
      summary,
    };
  }

  hasChanges(summary: ScriptEditSummary): boolean {
    return hasScriptEditChanges(summary);
  }

  private validateDocumentIdentity(
    script: PodcastScript,
    document: EditableScriptDocument
  ): void {
    if (document.scriptId !== script.id) {
      throw new ScriptEditValidationError(
        `Editable file belongs to script ${document.scriptId}, not ${script.id}.`
      );
    }
    const currentRevision = script.updatedAt.toISOString();
    // The revision is an optimistic-concurrency token. Without it, importing
    // an old file could silently discard changes made since it was exported.
    if (document.revision !== currentRevision) {
      throw new ScriptEditValidationError(
        `Editable file is stale. Exported revision ${document.revision}; current revision is ${currentRevision}. Export a fresh editable copy before applying changes.`
      );
    }
  }
}
