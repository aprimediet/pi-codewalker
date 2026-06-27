/**
 * SQLite database layer for codewalker.
 *
 * Uses better-sqlite3 with WAL mode. The schema follows the design in the build prompt:
 * - `files`: tracks indexed files (path, lang, sha, indexed_at)
 * - `symbols`: one row per extracted symbol
 * - `symbols_fts`: FTS5 virtual table for full-text search
 * - `meta`: key/value store for index metadata
 *
 * FTS5 uses external-content mode pointing at `symbols`. When re-indexing a file,
 * delete its rows + matching FTS rows, then INSERT fresh.
 */

import Database, { type Database as DatabaseType } from "better-sqlite3";

export { Database };
export type { DatabaseType };

/** Open a DB file path, enable WAL, and bootstrap schema. */
export function openDb(dbPath: string): DatabaseType {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  bootstrapDb(db);
  return db;
}

/** Bootstrap DDL — idempotent (all CREATE use IF NOT EXISTS). */
export function bootstrapDb(db: DatabaseType): void {
  db.exec(`
    PRAGMA user_version = 1;

    CREATE TABLE IF NOT EXISTS files (
      path        TEXT PRIMARY KEY,
      lang        TEXT,
      blob_sha    TEXT,
      indexed_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS symbols (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      kind        TEXT,
      file_path   TEXT,
      line_start  INTEGER,
      line_end    INTEGER,
      signature   TEXT,
      doc         TEXT,
      summary     TEXT,
      card_path   TEXT
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(
      name, signature, doc, summary,
      content='symbols', content_rowid='id',
      tokenize='unicode61 remove_diacritics 2'
    );

    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
  `);
}

/** Upsert a file record. */
export function upsertFile(
  db: DatabaseType,
  path: string,
  lang: string,
  blobSha: string,
): void {
  db.prepare(
    `INSERT INTO files (path, lang, blob_sha, indexed_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(path) DO UPDATE SET lang=excluded.lang, blob_sha=excluded.blob_sha, indexed_at=excluded.indexed_at`,
  ).run(path, lang, blobSha);
}

/** Delete file tracking row. */
export function deleteFile(db: DatabaseType, filePath: string): void {
  db.prepare("DELETE FROM files WHERE path = ?").run(filePath);
}

/** Insert or update a symbol. Replaces on (name, file_path) conflict. */
export function upsertSymbol(
  db: DatabaseType,
  symbol: {
    name: string;
    kind: string;
    file_path: string;
    line_start: number;
    line_end: number;
    signature: string;
    doc: string;
    summary: string;
    card_path: string;
  },
): void {
  // Delete existing FTS row for this row first (content=sync requires manual FTS management)
  // We use a replace-or-insert approach: delete old, insert new
  const existing = db.prepare(
    "SELECT id FROM symbols WHERE name = ? AND file_path = ?",
  ).get(symbol.name, symbol.file_path) as { id: number } | undefined;

  if (existing) {
    // FTS external content: must delete old content row
    db.prepare("INSERT INTO symbols_fts(symbols_fts, rowid, name, signature, doc, summary) VALUES ('delete', ?, '', '', '', '')").run(existing.id);
  }

  const result = db.prepare(
    `INSERT INTO symbols (name, kind, file_path, line_start, line_end, signature, doc, summary, card_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       kind=excluded.kind, line_start=excluded.line_start, line_end=excluded.line_end,
       signature=excluded.signature, doc=excluded.doc, summary=excluded.summary, card_path=excluded.card_path`,
  ).run(
    symbol.name, symbol.kind, symbol.file_path, symbol.line_start, symbol.line_end,
    symbol.signature, symbol.doc, symbol.summary, symbol.card_path,
  );

  // Insert into FTS
  const rowId = existing?.id ?? (result.lastInsertRowid as number);
  db.prepare(
    `INSERT INTO symbols_fts(rowid, name, signature, doc, summary)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(rowId, symbol.name, symbol.signature, symbol.doc, symbol.summary);
}

/** Delete all symbols for a given file. */
export function deleteFileSymbols(db: DatabaseType, filePath: string): void {
  const rows = db.prepare("SELECT id FROM symbols WHERE file_path = ?").all(filePath) as { id: number }[];
  for (const row of rows) {
    db.prepare("INSERT INTO symbols_fts(symbols_fts, rowid, name, signature, doc, summary) VALUES ('delete', ?, '', '', '', '')").run(row.id);
  }
  db.prepare("DELETE FROM symbols WHERE file_path = ?").run(filePath);
}

/** Search symbols via FTS5 MATCH, ranked by bm25. */
export function searchSymbols(
  db: DatabaseType,
  query: string,
  kindFilter?: string,
  limit = 10,
): Array<{
  id: number;
  name: string;
  kind: string;
  file_path: string;
  line_start: number;
  line_end: number;
  signature: string;
  summary: string;
  score: number;
}> {
  if (!query.trim()) {
    // Return all symbols ordered by name
    let sql = "SELECT s.id, s.name, s.kind, s.file_path, s.line_start, s.line_end, s.signature, s.summary, 0.0 as score FROM symbols s";
    const params: unknown[] = [];
    if (kindFilter) {
      sql += " WHERE s.kind = ?";
      params.push(kindFilter);
    }
    sql += " ORDER BY s.name LIMIT ?";
    params.push(limit);
    return db.prepare(sql).all(...params) as typeof results;
  }

  let sql = `
    SELECT s.id, s.name, s.kind, s.file_path, s.line_start, s.line_end, s.signature, s.summary,
           bm25(symbols_fts, 10.0, 5.0, 1.0, 8.0) as score
    FROM symbols_fts
    JOIN symbols s ON s.id = symbols_fts.rowid
    WHERE symbols_fts MATCH ?
  `;
  const params: unknown[] = [query];

  if (kindFilter) {
    sql += " AND s.kind = ?";
    params.push(kindFilter);
  }

  sql += " ORDER BY score LIMIT ?";
  params.push(limit);

  return db.prepare(sql).all(...params) as typeof results;
}

/** Get a meta value. */
export function getMeta(db: DatabaseType, key: string): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

/** Set a meta value. */
export function setMeta(db: DatabaseType, key: string, value: string): void {
  db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}
