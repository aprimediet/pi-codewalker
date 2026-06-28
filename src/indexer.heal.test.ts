/**
 * Regression test for the "database disk image is malformed" crash on `/codewalker scan`.
 *
 * A DB written by an older (pre-trigger, manual-FTS-sync) build can have a `symbols_fts`
 * external-content index that is silently out of sync with the `symbols` table. v1.3's bootstrap
 * adds the FTS-sync triggers, but those don't reconcile the already-stale index — so the per-row
 * DELETEs in scan() fire `symbols_ad` 'delete' commands against mismatched `old.*` values and
 * corrupt the index. scan()/sync() guard against this by calling rebuildFtsIndexes() first, which
 * re-derives every `*_fts` from its content table (the FTS5 'rebuild' command).
 *
 * The exact on-disk corruption is b-tree-state dependent and not portably synthesizable, so this
 * test pins the *fix mechanism*: rebuildFtsIndexes() reconciles a deliberately mismatched FTS.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { openDb, rebuildFtsIndexes } from "./db.ts";
import { scan } from "./indexer.ts";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cw-heal-"));
}

function matchCount(db: ReturnType<typeof openDb>, table: string, term: string): number {
  return (db.prepare(`SELECT count(*) c FROM ${table} WHERE ${table} MATCH ?`).get(term) as { c: number }).c;
}

describe("rebuildFtsIndexes heals a stale/mismatched FTS index", () => {
  it("makes content searchable and drops stale tokens for all three FTS tables", () => {
    const dir = tmpDir();
    const db = openDb(path.join(dir, "index.db"));

    // Seed base-table rows directly via FTS-bypassing inserts would still fire triggers, so to
    // simulate a *stale* index we insert the base row, then overwrite the FTS shadow with wrong
    // tokens (as a pre-trigger build would have left it).
    db.prepare(
      "INSERT INTO symbols (name,kind,file_path,line_start,line_end,signature,doc,summary,card_path) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run("realSymbol", "function", "/a.ts", 1, 2, "sig", "doc", "", "/c.md");
    db.prepare(
      "INSERT INTO lib_symbols (lib,version,name,kind,signature,doc,summary,card_path) VALUES (?,?,?,?,?,?,?,?)",
    ).run("hono", "1.0.0", "realLibSymbol", "function", "sig", "doc", "", "/c.md");
    db.prepare(
      "INSERT INTO notes (note_kind,title,body,tags,related,card_path,created_at) VALUES (?,?,?,?,?,?,?)",
    ).run("glossary", "realTerm", "body", "", "", "/c.md", "now");

    // Corrupt the shadow indexes: replace the synced tokens with bogus ones.
    db.exec("INSERT INTO symbols_fts(symbols_fts) VALUES('delete-all')");
    db.exec("INSERT INTO lib_symbols_fts(lib_symbols_fts) VALUES('delete-all')");
    db.exec("INSERT INTO notes_fts(notes_fts) VALUES('delete-all')");
    db.prepare("INSERT INTO symbols_fts(rowid,name,signature,doc,summary) VALUES (1,?,?,?,?)").run("WRONG", "x", "y", "z");
    db.prepare("INSERT INTO lib_symbols_fts(rowid,name,signature,doc,summary) VALUES (1,?,?,?,?)").run("WRONG", "x", "y", "z");
    db.prepare("INSERT INTO notes_fts(rowid,title,body,tags) VALUES (1,?,?,?)").run("WRONG", "y", "z");

    // Stale precondition: real content not findable, bogus token is.
    expect(matchCount(db, "symbols_fts", "realSymbol")).toBe(0);
    expect(matchCount(db, "symbols_fts", "WRONG")).toBe(1);

    rebuildFtsIndexes(db);

    // After heal: real content searchable, bogus tokens gone — across all three tables.
    expect(matchCount(db, "symbols_fts", "realSymbol")).toBe(1);
    expect(matchCount(db, "symbols_fts", "WRONG")).toBe(0);
    expect(matchCount(db, "lib_symbols_fts", "realLibSymbol")).toBe(1);
    expect(matchCount(db, "lib_symbols_fts", "WRONG")).toBe(0);
    expect(matchCount(db, "notes_fts", "realTerm")).toBe(1);
    expect(matchCount(db, "notes_fts", "WRONG")).toBe(0);

    db.close();
  });

  it("scan() runs the heal and leaves symbols_fts consistent with symbols", async () => {
    const dir = tmpDir();
    const dbPath = path.join(dir, "index.db");
    const entriesDir = path.join(dir, "entries");
    const symbolsDir = path.join(entriesDir, "symbols");
    fs.mkdirSync(symbolsDir, { recursive: true });

    await scan({ projectRoot: process.cwd(), globalCodewalkerDir: dir, dbPath, entriesDir, symbolsDir });

    const db = openDb(dbPath);
    const symbols = (db.prepare("SELECT count(*) c FROM symbols").get() as { c: number }).c;
    const fts = (db.prepare("SELECT count(*) c FROM symbols_fts").get() as { c: number }).c;
    db.close();

    expect(symbols).toBeGreaterThan(0);
    expect(fts).toBe(symbols);
  });
});
