/**
 * Note (glossary/decision) card rendering and parsing for codewalker v1.3.
 *
 * PURE module — no I/O. Renders a Note into a markdown card
 * with frontmatter head (note_kind, title, tags, related, summary) and body.
 *
 * Cards live at entries/glossary/<slug>.md and entries/decisions/<slug>.md.
 */

import type { Note, NoteKind } from "./types.ts";

/**
 * Render a Note (glossary term or decision) into a markdown card string.
 *
 * Frontmatter head includes note_kind, title, tags, related, summary.
 * Body starts with `# <title>` and contains the full body text.
 * Summary is the first line of the body.
 */
export function renderNoteCard(note: Note): string {
  const lines: string[] = ["---"];

  addNoteHeadField(lines, "note_kind", note.note_kind);
  addNoteHeadField(lines, "title", note.title);
  if (note.tags) addNoteHeadField(lines, "tags", note.tags);
  if (note.related) addNoteHeadField(lines, "related", note.related);

  // Summary = first line of body
  const summary = note.body.split("\n")[0]?.trim() || note.title;
  addNoteHeadField(lines, "summary", summary);

  lines.push("---");
  lines.push("");

  // Body
  lines.push(`# ${note.title}`);
  lines.push("");

  if (note.body) {
    lines.push(note.body);
  }

  return lines.join("\n") + "\n";
}

/**
 * Parse a note card from a markdown string.
 * Returns null if the card is invalid or not a note card.
 */
export function parseNoteCard(text: string): {
  note_kind: NoteKind;
  title: string;
  tags: string;
  related: string;
  summary: string;
} | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("---")) return null;

  const endOfFm = trimmed.indexOf("\n---", 3);
  if (endOfFm === -1) return null;

  const fmRaw = trimmed.slice(3, endOfFm).trim();

  // Parse frontmatter lines into a record
  const fm: Record<string, string> = {};
  for (const line of fmRaw.split("\n")) {
    const sep = line.indexOf(":");
    if (sep > 0) {
      const key = line.slice(0, sep).trim();
      const value = line.slice(sep + 1).trim();
      fm[key] = value;
    }
  }

  const noteKind = fm["note_kind"];
  if (noteKind !== "glossary" && noteKind !== "decision" && noteKind !== "convention") return null;
  if (!fm["title"]) return null;

  return {
    note_kind: noteKind as NoteKind,
    title: fm["title"] ?? "",
    tags: fm["tags"] ?? "",
    related: fm["related"] ?? "",
    summary: fm["summary"] ?? "",
  };
}

/** Add a key:value line to the frontmatter, sanitizing newlines. */
function addNoteHeadField(lines: string[], key: string, value: string): void {
  const safe = value.replace(/\n/g, " ").trim();
  lines.push(`${key}: ${safe}`);
}
