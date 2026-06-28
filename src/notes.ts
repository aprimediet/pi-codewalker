/**
 * Note orchestration for codewalker v1.3.
 *
 * Provides:
 * - `addNote()`: render card → atomic write → upsertNote
 * - `rebuildNotesDbFromCards()`: disposable-index rebuild from card files
 *
 * Mirrors the style of src/libs/indexer.ts (atomic write, tmp + rename, mode 0o600).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { openDb, upsertNote } from "./db.ts";
import { renderNoteCard, parseNoteCard } from "./notes-cards.ts";
import type { Note, NoteKind } from "./types.ts";

/**
 * Write a note: render card → atomic write → upsert DB row.
 *
 * The note's note_kind determines which directory to use.
 * When `notesDir` is provided, it is used directly (backward compat).
 * When both `glossaryDir` and `decisionsDir` are available, pass them via an options bag.
 */
export function addNote(
  dbPath: string,
  note: Note,
  notesDir?: string,
): void {
  const dir = notesDir;
  if (!dir) throw new Error("notesDir is required");

  // Ensure directory exists
  fs.mkdirSync(dir, { recursive: true });

  // Generate slug from title
  const slug = slugifyNoteTitle(note.title);
  const cardPath = path.join(dir, `${slug}.md`);

  // Render card
  const card = renderNoteCard(note);

  // Atomic write
  const tmpPath = cardPath + ".tmp";
  fs.writeFileSync(tmpPath, card, { encoding: "utf-8", mode: 0o600 });
  fs.renameSync(tmpPath, cardPath);

  // Upsert DB row with the actual card_path
  const db = openDb(dbPath);
  try {
    upsertNote(db, {
      ...note,
      card_path: cardPath,
    });
  } finally {
    db.close();
  }
}

/**
 * Rebuild the notes DB tables from glossary + decisions cards alone.
 * Demonstrates the disposable-index property: cards are the source of truth.
 */
export function rebuildNotesDbFromCards(
  dbPath: string,
  glossaryDir: string,
  decisionsDir: string,
): void {
  const db = openDb(dbPath);

  try {
    db.exec("BEGIN TRANSACTION");

    // Clear existing notes
    db.prepare("DELETE FROM notes").run();

    // Process glossary cards
    if (fs.existsSync(glossaryDir)) {
      processCardsInDir(db, glossaryDir, "glossary");
    }

    // Process decisions cards
    if (fs.existsSync(decisionsDir)) {
      processCardsInDir(db, decisionsDir, "decision");
    }

    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  } finally {
    db.close();
  }
}

// ── Internal helpers ───────────────────────────────────────────

function processCardsInDir(
  db: ReturnType<typeof openDb>,
  dir: string,
  expectedKind: NoteKind,
): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;

    const cardPath = path.join(dir, entry.name);
    const cardText = fs.readFileSync(cardPath, "utf-8");
    const parsed = parseNoteCard(cardText);
    if (!parsed) continue;
    if (parsed.note_kind !== expectedKind) continue;

    // Extract body from card
    const body = extractNoteBody(cardText);

    upsertNote(db, {
      note_kind: parsed.note_kind,
      title: parsed.title,
      body,
      tags: parsed.tags,
      related: parsed.related,
      card_path: cardPath,
    });
  }
}

/** Extract the body (after frontmatter) from a note card, stripping the # title header. */
function extractNoteBody(cardText: string): string {
  const trimmed = cardText.trim();
  if (!trimmed.startsWith("---")) return "";

  const endOfFm = trimmed.indexOf("\n---", 3);
  if (endOfFm === -1) return "";

  return trimmed.slice(endOfFm + 4).trim();
}

function slugifyNoteTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "untitled";
}

// Re-export for convenience
export { slugifyNoteTitle };
