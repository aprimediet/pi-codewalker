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
import type { LibSymbol } from "./types.ts";

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
    PRAGMA user_version = 2;

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

    CREATE TABLE IF NOT EXISTS libraries (
      name        TEXT NOT NULL,
      version     TEXT NOT NULL,
      source      TEXT,
      dts_path    TEXT,
      readme      TEXT,
      indexed_at  TEXT,
      PRIMARY KEY (name, version)
    );

    CREATE TABLE IF NOT EXISTS lib_symbols (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      lib         TEXT NOT NULL,
      version     TEXT NOT NULL,
      name        TEXT NOT NULL,
      kind        TEXT,
      signature   TEXT,
      doc         TEXT,
      summary     TEXT,
      card_path   TEXT
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS lib_symbols_fts USING fts5(
      name, signature, doc, summary,
      content='lib_symbols', content_rowid='id',
      tokenize='unicode61 remove_diacritics 2'
    );

    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

    -- Keep the external-content FTS indexes in sync via triggers (the SQLite-documented
    -- pattern). Code must do plain INSERT/UPDATE/DELETE on the base tables and NEVER touch
    -- the *_fts tables directly: the 'delete' command needs the ORIGINAL column values, which
    -- only the triggers (via old.*) have. Hand-rolled FTS maintenance with empty/placeholder
    -- values corrupts the index ("database disk image is malformed").
    CREATE TRIGGER IF NOT EXISTS symbols_ai AFTER INSERT ON symbols BEGIN
      INSERT INTO symbols_fts(rowid, name, signature, doc, summary)
      VALUES (new.id, new.name, new.signature, new.doc, new.summary);
    END;
    CREATE TRIGGER IF NOT EXISTS symbols_ad AFTER DELETE ON symbols BEGIN
      INSERT INTO symbols_fts(symbols_fts, rowid, name, signature, doc, summary)
      VALUES ('delete', old.id, old.name, old.signature, old.doc, old.summary);
    END;
    CREATE TRIGGER IF NOT EXISTS symbols_au AFTER UPDATE ON symbols BEGIN
      INSERT INTO symbols_fts(symbols_fts, rowid, name, signature, doc, summary)
      VALUES ('delete', old.id, old.name, old.signature, old.doc, old.summary);
      INSERT INTO symbols_fts(rowid, name, signature, doc, summary)
      VALUES (new.id, new.name, new.signature, new.doc, new.summary);
    END;

    CREATE TRIGGER IF NOT EXISTS lib_symbols_ai AFTER INSERT ON lib_symbols BEGIN
      INSERT INTO lib_symbols_fts(rowid, name, signature, doc, summary)
      VALUES (new.id, new.name, new.signature, new.doc, new.summary);
    END;
    CREATE TRIGGER IF NOT EXISTS lib_symbols_ad AFTER DELETE ON lib_symbols BEGIN
      INSERT INTO lib_symbols_fts(lib_symbols_fts, rowid, name, signature, doc, summary)
      VALUES ('delete', old.id, old.name, old.signature, old.doc, old.summary);
    END;
    CREATE TRIGGER IF NOT EXISTS lib_symbols_au AFTER UPDATE ON lib_symbols BEGIN
      INSERT INTO lib_symbols_fts(lib_symbols_fts, rowid, name, signature, doc, summary)
      VALUES ('delete', old.id, old.name, old.signature, old.doc, old.summary);
      INSERT INTO lib_symbols_fts(rowid, name, signature, doc, summary)
      VALUES (new.id, new.name, new.signature, new.doc, new.summary);
    END;
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
  // Plain INSERT — the symbols_ai trigger keeps symbols_fts in sync. Callers (scan/sync) always
  // delete a file's symbols before re-inserting, so re-indexing is idempotent without an update path.
  db.prepare(
    `INSERT INTO symbols (name, kind, file_path, line_start, line_end, signature, doc, summary, card_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    symbol.name, symbol.kind, symbol.file_path, symbol.line_start, symbol.line_end,
    symbol.signature, symbol.doc, symbol.summary, symbol.card_path,
  );
}

/** Delete all symbols for a given file. The symbols_ad trigger removes their FTS rows. */
export function deleteFileSymbols(db: DatabaseType, filePath: string): void {
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

/** Upsert a library record. */
export function upsertLibrary(
  db: DatabaseType,
  pkg: { name: string; version: string; source?: string; dts_path?: string | null; readme?: string | null },
): void {
  db.prepare(
    `INSERT INTO libraries (name, version, source, dts_path, readme, indexed_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(name, version) DO UPDATE SET
       source=excluded.source, dts_path=excluded.dts_path, readme=excluded.readme, indexed_at=excluded.indexed_at`,
  ).run(pkg.name, pkg.version, pkg.source ?? null, pkg.dts_path ?? null, pkg.readme ?? null);
}

/** Upsert a lib symbol. Replaces on (lib, name) duplicate. */
export function upsertLibSymbol(
  db: DatabaseType,
  symbol: {
    lib: string;
    version: string;
    name: string;
    kind: string;
    signature: string;
    doc: string;
    summary: string;
    card_path: string;
  },
): void {
  // The lib_symbols_ai / _au triggers keep lib_symbols_fts in sync — never touch the FTS table here.
  const existing = db.prepare(
    "SELECT id FROM lib_symbols WHERE lib = ? AND name = ?",
  ).get(symbol.lib, symbol.name) as { id: number } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE lib_symbols SET version=?, kind=?, signature=?, doc=?, summary=?, card_path=?
       WHERE id = ?`,
    ).run(
      symbol.version, symbol.kind, symbol.signature,
      symbol.doc, symbol.summary, symbol.card_path,
      existing.id,
    );
  } else {
    db.prepare(
      `INSERT INTO lib_symbols (lib, version, name, kind, signature, doc, summary, card_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      symbol.lib, symbol.version, symbol.name, symbol.kind,
      symbol.signature, symbol.doc, symbol.summary, symbol.card_path,
    );
  }
}

/** Delete all lib_symbols (all versions) for a library, then the libraries rows.
 *  The lib_symbols_ad trigger removes the FTS rows. */
export function deleteLibrary(db: DatabaseType, libName: string): void {
  db.prepare("DELETE FROM lib_symbols WHERE lib = ?").run(libName);
  db.prepare("DELETE FROM libraries WHERE name = ?").run(libName);
}

/**
 * Search lib symbols via FTS5 MATCH, ranked by bm25.
 * Empty query returns all symbols ordered by name.
 */
export function searchLibSymbols(
  db: DatabaseType,
  query: string,
  kindFilter?: string,
  limit = 10,
): Array<{
  id: number;
  name: string;
  kind: string;
  lib: string;
  version: string;
  file_path: string;
  line_start: number;
  line_end: number;
  signature: string;
  summary: string;
  score: number;
  source: "lib";
}> {
  if (!query.trim()) {
    let sql = "SELECT s.id, s.name, s.kind, s.lib, s.version, s.signature, s.summary, 0.0 as score FROM lib_symbols s";
    const params: unknown[] = [];
    if (kindFilter) {
      sql += " WHERE s.kind = ?";
      params.push(kindFilter);
    }
    sql += " ORDER BY s.name LIMIT ?";
    params.push(limit);
    return db.prepare(sql).all(...params).map((r: any) => ({
      ...r,
      file_path: "",
      line_start: 0,
      line_end: 0,
      source: "lib" as const,
    }));
  }

  let sql = `
    SELECT s.id, s.name, s.kind, s.lib, s.version, s.signature, s.summary,
           bm25(lib_symbols_fts, 10.0, 5.0, 1.0, 8.0) as score
    FROM lib_symbols_fts
    JOIN lib_symbols s ON s.id = lib_symbols_fts.rowid
    WHERE lib_symbols_fts MATCH ?
  `;
  const params: unknown[] = [query];

  if (kindFilter) {
    sql += " AND s.kind = ?";
    params.push(kindFilter);
  }

  sql += " ORDER BY score LIMIT ?";
  params.push(limit);

  return db.prepare(sql).all(...params).map((r: any) => ({
    ...r,
    file_path: "",
    line_start: 0,
    line_end: 0,
    source: "lib" as const,
  }));
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
