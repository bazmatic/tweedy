import { SpeakerAgentToolName } from "../agents/speaker-tools";
import {
  EditableScriptDocument,
  EditableScriptTurn,
  PodcastScript,
} from "../types";

export const SCRIPT_EDIT_FORMAT_VERSION = 1;

enum EditableField {
  Format = "@format:",
  Script = "@script:",
  Revision = "@revision:",
  Id = "@id:",
  Speaker = "@speaker:",
  Mode = "@mode:",
}

const NEW_TURN_ID = "new";

export class ScriptEditFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptEditFormatError";
  }
}

export function formatScriptForEditing(script: PodcastScript): string {
  const lines = [
    "# tweedy editable script",
    `${EditableField.Format} ${SCRIPT_EDIT_FORMAT_VERSION}`,
    `${EditableField.Script} ${script.id}`,
    `${EditableField.Revision} ${script.updatedAt.toISOString()}`,
    "#",
    "# Edit message text freely. Keep existing @id and @speaker values unchanged.",
    "# Delete or reorder whole turn blocks as needed.",
    `# Add a turn with \"${EditableField.Id} ${NEW_TURN_ID}\" and a script speaker slug.`,
    "# @mode is optional: existing turns retain their mode; new turns default to speak.",
    `# Valid @mode values: ${Object.values(SpeakerAgentToolName).join(", ")}.`,
    "",
  ];

  for (const speech of script.speeches) {
    lines.push(`${EditableField.Id} ${speech.id}`);
    lines.push(`${EditableField.Speaker} ${speech.speaker.slug}`);
    lines.push(
      `${EditableField.Mode} ${speech.tool ?? SpeakerAgentToolName.SPEAK}`
    );
    lines.push(speech.message.trim());
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function parseEditableScript(text: string): EditableScriptDocument {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  // The first @id marks the boundary between fixed document metadata and the
  // ordered turn blocks. No @id is valid and means "remove every turn".
  const firstTurnIndex = lines.findIndex((line) =>
    line.trimStart().startsWith(EditableField.Id)
  );
  const headerEnd = firstTurnIndex < 0 ? lines.length : firstTurnIndex;
  const header = parseHeader(lines.slice(0, headerEnd));
  const turns =
    firstTurnIndex < 0
      ? []
      : parseTurns(lines.slice(firstTurnIndex), firstTurnIndex + 1);
  return { ...header, turns };
}

function parseHeader(
  lines: string[]
): Omit<EditableScriptDocument, "turns"> {
  const values = new Map<EditableField, string>();
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const field = [
      EditableField.Format,
      EditableField.Script,
      EditableField.Revision,
    ].find((candidate) => line.startsWith(candidate));
    if (!field) {
      throw new ScriptEditFormatError(
        `Unknown header field on line ${index + 1}: ${line}`
      );
    }
    if (values.has(field)) {
      throw new ScriptEditFormatError(
        `Duplicate header field ${field} on line ${index + 1}.`
      );
    }
    values.set(field, readFieldValue(line, field, index + 1));
  }

  const formatText = requireHeader(values, EditableField.Format);
  const formatVersion = Number(formatText);
  if (formatVersion !== SCRIPT_EDIT_FORMAT_VERSION) {
    throw new ScriptEditFormatError(
      `Unsupported editable script format ${formatText}; expected ${SCRIPT_EDIT_FORMAT_VERSION}.`
    );
  }

  return {
    formatVersion,
    scriptId: requireHeader(values, EditableField.Script),
    revision: requireHeader(values, EditableField.Revision),
  };
}

function parseTurns(lines: string[], startingLine: number): EditableScriptTurn[] {
  // Turns are block-based rather than blank-line-based so editors may use
  // paragraphs inside a single speech without changing the document structure.
  const blockStarts = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.trimStart().startsWith(EditableField.Id))
    .map(({ index }) => index);
  const turns: EditableScriptTurn[] = [];
  const existingIds = new Set<string>();

  for (const [blockIndex, start] of blockStarts.entries()) {
    const end = blockStarts[blockIndex + 1] ?? lines.length;
    const block = lines.slice(start, end);
    const lineNumber = startingLine + start;
    const idValue = readFieldValue(
      block[0].trim(),
      EditableField.Id,
      lineNumber
    );
    const sourceId = idValue === NEW_TURN_ID ? undefined : idValue;
    if (sourceId && existingIds.has(sourceId)) {
      throw new ScriptEditFormatError(
        `Duplicate turn id ${sourceId} on line ${lineNumber}.`
      );
    }
    if (sourceId) existingIds.add(sourceId);

    const speakerIndex = nextContentLine(block, 1);
    const speakerLine = block[speakerIndex]?.trim();
    if (!speakerLine?.startsWith(EditableField.Speaker)) {
      throw new ScriptEditFormatError(
        `Turn on line ${lineNumber} must include @speaker immediately after @id.`
      );
    }
    const speakerSlug = readFieldValue(
      speakerLine,
      EditableField.Speaker,
      lineNumber + speakerIndex
    );

    let messageStart = nextContentLine(block, speakerIndex + 1);
    let mode: SpeakerAgentToolName | undefined;
    const possibleModeLine = block[messageStart]?.trim();
    if (possibleModeLine?.startsWith(EditableField.Mode)) {
      const modeValue = readFieldValue(
        possibleModeLine,
        EditableField.Mode,
        lineNumber + messageStart
      );
      mode = Object.values(SpeakerAgentToolName).find(
        (candidate) => candidate === modeValue
      );
      if (!mode) {
        throw new ScriptEditFormatError(
          `Unknown turn mode "${modeValue}" on line ${lineNumber + messageStart}.`
        );
      }
      messageStart = nextContentLine(block, messageStart + 1);
    }

    const message = block.slice(messageStart).join("\n").trim();
    if (!message) {
      throw new ScriptEditFormatError(
        `Turn on line ${lineNumber} has no message text.`
      );
    }
    turns.push({ sourceId, speakerSlug, message, mode });
  }

  return turns;
}

function nextContentLine(lines: string[], start: number): number {
  let index = start;
  while (index < lines.length && !lines[index].trim()) index++;
  return index;
}

function readFieldValue(
  line: string,
  field: EditableField,
  lineNumber: number
): string {
  const value = line.slice(field.length).trim();
  if (!value) {
    throw new ScriptEditFormatError(
      `Missing value for ${field} on line ${lineNumber}.`
    );
  }
  return value;
}

function requireHeader(
  values: Map<EditableField, string>,
  field: EditableField
): string {
  const value = values.get(field);
  if (!value) {
    throw new ScriptEditFormatError(`Missing required header field ${field}.`);
  }
  return value;
}
