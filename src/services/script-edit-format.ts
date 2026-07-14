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
const TURN_END = "@end";

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
    `# Keep each ${TURN_END} marker. Write \\${TURN_END} for a literal ${TURN_END} message line.`,
    `# Valid @mode values: ${Object.values(SpeakerAgentToolName).join(", ")}.`,
    "",
  ];

  for (const speech of script.speeches) {
    lines.push(`${EditableField.Id} ${speech.id}`);
    lines.push(`${EditableField.Speaker} ${speech.speaker.slug}`);
    lines.push(
      `${EditableField.Mode} ${speech.tool ?? SpeakerAgentToolName.SPEAK}`
    );
    lines.push(escapeMessage(speech.message.trim()));
    lines.push(TURN_END);
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
  // Explicit end markers keep metadata-looking message lines unambiguous while
  // still allowing blank lines and paragraphs inside a speech.
  const turns: EditableScriptTurn[] = [];
  const existingIds = new Set<string>();
  let cursor = 0;

  while (cursor < lines.length) {
    cursor = nextContentLine(lines, cursor);
    if (cursor >= lines.length) break;

    const lineNumber = startingLine + cursor;
    const idLine = lines[cursor].trim();
    if (!idLine.startsWith(EditableField.Id)) {
      throw new ScriptEditFormatError(
        `Expected ${EditableField.Id} on line ${lineNumber}.`
      );
    }
    const idValue = readFieldValue(idLine, EditableField.Id, lineNumber);
    const sourceId = idValue === NEW_TURN_ID ? undefined : idValue;
    if (sourceId && existingIds.has(sourceId)) {
      throw new ScriptEditFormatError(
        `Duplicate turn id ${sourceId} on line ${lineNumber}.`
      );
    }
    if (sourceId) existingIds.add(sourceId);

    const speakerIndex = nextContentLine(lines, cursor + 1);
    const speakerLine = lines[speakerIndex]?.trim();
    if (!speakerLine?.startsWith(EditableField.Speaker)) {
      throw new ScriptEditFormatError(
        `Turn on line ${lineNumber} must include @speaker immediately after @id.`
      );
    }
    const speakerSlug = readFieldValue(
      speakerLine,
      EditableField.Speaker,
      startingLine + speakerIndex
    );

    let messageStart = nextContentLine(lines, speakerIndex + 1);
    let mode: SpeakerAgentToolName | undefined;
    const possibleModeLine = lines[messageStart]?.trim();
    if (possibleModeLine?.startsWith(EditableField.Mode)) {
      const modeValue = readFieldValue(
        possibleModeLine,
        EditableField.Mode,
        startingLine + messageStart
      );
      mode = Object.values(SpeakerAgentToolName).find(
        (candidate) => candidate === modeValue
      );
      if (!mode) {
        throw new ScriptEditFormatError(
          `Unknown turn mode "${modeValue}" on line ${startingLine + messageStart}.`
        );
      }
      messageStart = nextContentLine(lines, messageStart + 1);
    }

    const end = lines.findIndex(
      (line, index) => index >= messageStart && line.trim() === TURN_END
    );
    if (end < 0) {
      throw new ScriptEditFormatError(
        `Turn on line ${lineNumber} is missing its ${TURN_END} marker.`
      );
    }
    const message = unescapeMessage(
      lines.slice(messageStart, end).join("\n")
    ).trim();
    if (!message) {
      throw new ScriptEditFormatError(
        `Turn on line ${lineNumber} has no message text.`
      );
    }
    turns.push({ sourceId, speakerSlug, message, mode });
    cursor = end + 1;
  }

  return turns;
}

function escapeMessage(message: string): string {
  return message
    .split("\n")
    .map((line) => escapeReservedLine(line))
    .join("\n");
}

function unescapeMessage(message: string): string {
  return message
    .split("\n")
    .map((line) => unescapeReservedLine(line))
    .join("\n");
}

function escapeReservedLine(line: string): string {
  const firstContentIndex = line.search(/\S/);
  if (firstContentIndex < 0 || !/^\\*@end$/.test(line.trim())) return line;
  return `${line.slice(0, firstContentIndex)}\\${line.slice(firstContentIndex)}`;
}

function unescapeReservedLine(line: string): string {
  const firstContentIndex = line.search(/\S/);
  if (firstContentIndex < 0 || !/^\\+@end$/.test(line.trim())) return line;
  return `${line.slice(0, firstContentIndex)}${line.slice(firstContentIndex + 1)}`;
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
