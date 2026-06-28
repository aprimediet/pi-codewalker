import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { openDb, bootstrapDb, upsertSymbol, searchSymbols, getMeta, setMeta, deleteFileSymbols, upsertLibrary, upsertLibSymbol, deleteLibrary, searchLibSymbols, upsertNote, searchNotes, deleteNote, updateSymbolSummary, selectUnenrichedSymbols } from './db.ts';

describe('db.ts', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-db-'));
    dbPath = path.join(tmpDir, 'test.db');
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('bootstrapDb', () => {
    it('creates files, symbols, symbols_fts, and meta tables', () => {
      const db = new Database(dbPath);
      bootstrapDb(db);
      db.close();

      // Re-open and check tables exist
      const db2 = new Database(dbPath);
      const tables = db2.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
      const tableNames = tables.map(t => t.name);
      expect(tableNames).toContain('files');
      expect(tableNames).toContain('symbols');
      expect(tableNames).toContain('meta');

      // Check FTS virtual table (shows as 'table' type in sqlite_master)
      const ftsTables = db2.prepare("SELECT name FROM sqlite_master WHERE name='symbols_fts'").all() as { name: string }[];
      expect(ftsTables.length).toBe(1);
      expect(ftsTables[0]!.name).toBe('symbols_fts');
      db2.close();
    });

    it('is idempotent (can be called twice)', () => {
      const db = new Database(dbPath);
      bootstrapDb(db);
      bootstrapDb(db);
      db.close();
      // No error = idempotent
    });

    it('sets user_version to 3 (v1.3 schema)', () => {
      const db = new Database(dbPath);
      bootstrapDb(db);
      const version = db.pragma('user_version', { simple: true }) as number;
      expect(version).toBe(3);
      db.close();
    });

    it('creates libraries, lib_symbols, and lib_symbols_fts tables', () => {
      const db = openDb(dbPath);
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
      const tableNames = tables.map(t => t.name);
      expect(tableNames).toContain('libraries');
      expect(tableNames).toContain('lib_symbols');

      const ftsTables = db.prepare("SELECT name FROM sqlite_master WHERE name='lib_symbols_fts'").all() as { name: string }[];
      expect(ftsTables.length).toBe(1);
      db.close();
    });

    it('does not destroy existing tables (additive upgrade, v2 → notes in v3)', () => {
      // Bootstrap then re-bootstrap (simulate upgrade)
      const db = new Database(dbPath);
      bootstrapDb(db);
      upsertSymbol(db, {
        name: 'keep', kind: 'function', file_path: 'src/a.ts',
        line_start: 1, line_end: 1, signature: '', doc: '', summary: '', card_path: '',
      });

      // Call bootstrapDb again (simulates upgrade to v3 adds notes tables)
      bootstrapDb(db);

      // Symbol still there
      const symbols = searchSymbols(db, 'keep', undefined, 10);
      expect(symbols).toHaveLength(1);

      // Notes tables exist
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
      expect(tables.map(t => t.name)).toContain('notes');

      const ftsTables = db.prepare("SELECT name FROM sqlite_master WHERE name='notes_fts'").all() as { name: string }[];
      expect(ftsTables.length).toBe(1);
      db.close();
    });
  });

  describe('openDb', () => {
    it('opens a DB and bootstraps it', () => {
      const db = openDb(dbPath);
      expect(db.open).toBe(true);
      // Tables exist
      const count = db.prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table'").get() as { c: number };
      expect(count.c).toBeGreaterThan(0);
      db.close();
    });
  });

  describe('symbols CRUD', () => {
    it('inserts a symbol and finds it via FTS MATCH', () => {
      const db = openDb(dbPath);

      upsertSymbol(db, {
        name: 'myFunc',
        kind: 'function',
        file_path: 'src/test.ts',
        line_start: 10,
        line_end: 20,
        signature: '(x: number) => string',
        doc: 'Does something useful',
        summary: '',
        card_path: '/cards/myFunc.md',
      });

      // FTS search
      const results = searchSymbols(db, 'myFunc', undefined, 10);
      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe('myFunc');
      expect(results[0]!.kind).toBe('function');

      db.close();
    });

    it('bm25 ranks name hit above doc-only hit', () => {
      const db = openDb(dbPath);

      // Doc hit: "token" only appears in doc text, not in name
      upsertSymbol(db, {
        name: 'loadData',
        kind: 'function',
        file_path: 'src/a.ts',
        line_start: 1,
        line_end: 5,
        signature: '() => void',
        doc: 'Helper to refresh the auth token',
        summary: '',
        card_path: '',
      });

      // Name hit: "token" is in the name
      upsertSymbol(db, {
        name: 'refreshToken',
        kind: 'function',
        file_path: 'src/b.ts',
        line_start: 10,
        line_end: 15,
        signature: '() => Promise<string>',
        doc: 'Gets a new token',
        summary: '',
        card_path: '',
      });

      const results = searchSymbols(db, 'token', undefined, 10);
      expect(results.length).toBeGreaterThanOrEqual(2);
      // First result should be the name hit (name is weighted higher in bm25)
      expect(results[0]!.name).toBe('refreshToken');

      db.close();
    });

    it('re-indexing a file is idempotent (no duplicate rows)', () => {
      const db = openDb(dbPath);

      // First insert
      upsertSymbol(db, {
        name: 'foo', kind: 'function', file_path: 'src/test.ts',
        line_start: 1, line_end: 1, signature: '', doc: '', summary: '', card_path: '',
      });

      // Re-insert same file (simulate reindex)
      deleteFileSymbols(db, 'src/test.ts');
      upsertSymbol(db, {
        name: 'foo', kind: 'function', file_path: 'src/test.ts',
        line_start: 1, line_end: 1, signature: '', doc: '', summary: '', card_path: '',
      });

      const results = searchSymbols(db, 'foo', undefined, 10);
      expect(results).toHaveLength(1);

      db.close();
    });

    it('deleting a file removes only its symbols', () => {
      const db = openDb(dbPath);

      upsertSymbol(db, {
        name: 'keep', kind: 'function', file_path: 'src/keep.ts',
        line_start: 1, line_end: 1, signature: '', doc: '', summary: '', card_path: '',
      });
      upsertSymbol(db, {
        name: 'remove', kind: 'function', file_path: 'src/remove.ts',
        line_start: 2, line_end: 2, signature: '', doc: '', summary: '', card_path: '',
      });

      deleteFileSymbols(db, 'src/remove.ts');

      const all = searchSymbols(db, '', undefined, 10);
      expect(all).toHaveLength(1);
      expect(all[0]!.name).toBe('keep');

      db.close();
    });
  });

  describe('library CRUD', () => {
    it('upsertLibrary inserts or updates a library record', () => {
      const db = openDb(dbPath);
      upsertLibrary(db, { name: 'hono', version: '4.6.3', source: 'node_modules', dts_path: '/a.d.ts', readme: 'Hono web framework' });

      const row = db.prepare("SELECT * FROM libraries WHERE name = ?").get('hono') as any;
      expect(row).not.toBeUndefined();
      expect(row.version).toBe('4.6.3');
      expect(row.source).toBe('node_modules');
      db.close();
    });

    it('upsertLibSymbol inserts a lib symbol and it is FTS-searchable', () => {
      const db = openDb(dbPath);
      upsertLibSymbol(db, {
        lib: 'hono', version: '4.6.3', name: 'createMiddleware',
        kind: 'function', signature: 'export declare function createMiddleware(...)',
        doc: 'Define a typed middleware handler.', summary: 'Define a typed middleware handler.',
        card_path: '/cards/hono/createMiddleware.md',
      });

      const results = searchLibSymbols(db, 'createMiddleware', undefined, 10);
      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe('createMiddleware');
      expect(results[0]!.lib).toBe('hono');
      expect(results[0]!.version).toBe('4.6.3');
      expect(results[0]!.source).toBe('lib');

      db.close();
    });

    it('searchLibSymbols empty query returns all symbols ordered by name', () => {
      const db = openDb(dbPath);
      upsertLibSymbol(db, {
        lib: 'hono', version: '4.6.3', name: 'zMiddleware',
        kind: 'function', signature: '', doc: '', summary: '', card_path: '',
      });
      upsertLibSymbol(db, {
        lib: 'hono', version: '4.6.3', name: 'aRouter',
        kind: 'function', signature: '', doc: '', summary: '', card_path: '',
      });

      const results = searchLibSymbols(db, '', undefined, 10);
      expect(results).toHaveLength(2);
      expect(results[0]!.name).toBe('aRouter');
      expect(results[1]!.name).toBe('zMiddleware');
      db.close();
    });

    it('deleteLibrary removes symbols and FTS rows for all versions of a lib', () => {
      const db = openDb(dbPath);

      upsertLibSymbol(db, {
        lib: 'hono', version: '4.6.3', name: 'createMiddleware',
        kind: 'function', signature: '', doc: '', summary: '', card_path: '',
      });
      upsertLibSymbol(db, {
        lib: 'hono', version: '4.5.0', name: 'oldFunc',
        kind: 'function', signature: '', doc: '', summary: '', card_path: '',
      });

      deleteLibrary(db, 'hono');

      const results = searchLibSymbols(db, '', undefined, 10);
      expect(results).toHaveLength(0);

      const libRow = db.prepare("SELECT * FROM libraries WHERE name = ?").get('hono') as any;
      expect(libRow).toBeUndefined();

      db.close();
    });

    it('re-inserting same (lib, name) does not create duplicates', () => {
      const db = openDb(dbPath);

      upsertLibSymbol(db, {
        lib: 'hono', version: '4.6.3', name: 'createMiddleware',
        kind: 'function', signature: 'v1', doc: '', summary: '', card_path: '',
      });
      upsertLibSymbol(db, {
        lib: 'hono', version: '4.6.3', name: 'createMiddleware',
        kind: 'function', signature: 'v2', doc: '', summary: '', card_path: '',
      });

      const results = searchLibSymbols(db, 'createMiddleware', undefined, 10);
      expect(results).toHaveLength(1);
      // Latest signature
      expect(results[0]!.signature).toBe('v2');

      db.close();
    });

    it('kind filter narrows lib symbol results', () => {
      const db = openDb(dbPath);

      upsertLibSymbol(db, {
        lib: 'hono', version: '4.6.3', name: 'myFunc',
        kind: 'function', signature: '', doc: '', summary: '', card_path: '',
      });
      upsertLibSymbol(db, {
        lib: 'hono', version: '4.6.3', name: 'MyType',
        kind: 'type', signature: '', doc: '', summary: '', card_path: '',
      });

      const funcs = searchLibSymbols(db, '', 'function', 10);
      expect(funcs).toHaveLength(1);
      expect(funcs[0]!.name).toBe('myFunc');

      db.close();
    });
  });

  describe('notes CRUD + FTS via triggers', () => {
    it('creates notes + notes_fts on bootstrap', () => {
      const db = openDb(dbPath);
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
      expect(tables.map(t => t.name)).toContain('notes');

      const ftsTables = db.prepare("SELECT name FROM sqlite_master WHERE name='notes_fts'").all() as { name: string }[];
      expect(ftsTables.length).toBe(1);

      // Triggers exist
      const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all() as { name: string }[];
      const triggerNames = triggers.map(t => t.name);
      expect(triggerNames).toContain('notes_ai');
      expect(triggerNames).toContain('notes_ad');
      expect(triggerNames).toContain('notes_au');
      db.close();
    });

    it('upsertNote inserts a note and FTS MATCH finds it', () => {
      const db = openDb(dbPath);

      const id = upsertNote(db, {
        note_kind: 'glossary',
        title: 'Idempotency Key',
        body: 'A client-supplied key that makes a retried POST safe to replay.',
        tags: 'api,payments',
        related: 'createCharge',
        card_path: '/entries/glossary/idempotency-key.md',
      });

      expect(typeof id).toBe('number');
      expect(id).toBeGreaterThan(0);

      // FTS search
      const results = searchNotes(db, 'idempotency');
      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe('Idempotency Key');
      expect(results[0]!.note_kind).toBe('glossary');
      expect(results[0]!.source).toBe('note');

      db.close();
    });

    it('upsertNote upserts on (note_kind, title) — updating a note refreshes FTS via notes_au', () => {
      const db = openDb(dbPath);

      upsertNote(db, {
        note_kind: 'glossary',
        title: 'Retry Key',
        body: 'Old description',
        tags: '',
        related: '',
        card_path: '/entries/glossary/retry-key.md',
      });

      // Update the body
      upsertNote(db, {
        note_kind: 'glossary',
        title: 'Retry Key',
        body: 'New improved description with uniqueTermXYZ',
        tags: 'updated',
        related: '',
        card_path: '/entries/glossary/retry-key.md',
      });

      // Should find by new text (proves notes_au fired the reindex)
      const results = searchNotes(db, 'uniqueTermXYZ');
      expect(results).toHaveLength(1);
      expect(results[0]!.summary).toContain('uniqueTermXYZ');

      // Should NOT have duplicates (upsert behavior)
      const all = searchNotes(db, '');
      expect(all).toHaveLength(1);

      db.close();
    });

    it('deleteNote removes a note from both base table and FTS', () => {
      const db = openDb(dbPath);

      upsertNote(db, {
        note_kind: 'glossary',
        title: 'Temp Term',
        body: 'Will be deleted',
        tags: '',
        related: '',
        card_path: '',
      });

      deleteNote(db, 'glossary', 'Temp Term');

      const results = searchNotes(db, 'Temp');
      expect(results).toHaveLength(0);

      // Verify base table is also empty
      const row = db.prepare("SELECT * FROM notes WHERE title = ?").get('Temp Term');
      expect(row).toBeUndefined();

      db.close();
    });

    it('searchNotes empty query returns all notes ordered by title', () => {
      const db = openDb(dbPath);

      upsertNote(db, {
        note_kind: 'glossary', title: 'Zebra', body: '', tags: '', related: '', card_path: '',
      });
      upsertNote(db, {
        note_kind: 'decision', title: 'Alpha decision', body: '', tags: '', related: '', card_path: '',
      });

      const results = searchNotes(db, '');
      expect(results).toHaveLength(2);
      expect(results[0]!.name).toBe('Alpha decision');
      expect(results[1]!.name).toBe('Zebra');

      db.close();
    });

    it('searchNotes with kindFilter narrows by note_kind', () => {
      const db = openDb(dbPath);

      upsertNote(db, {
        note_kind: 'glossary', title: 'Term', body: '', tags: '', related: '', card_path: '',
      });
      upsertNote(db, {
        note_kind: 'decision', title: 'Decide', body: '', tags: '', related: '', card_path: '',
      });

      const glossaryResults = searchNotes(db, '', 'glossary');
      expect(glossaryResults).toHaveLength(1);
      expect(glossaryResults[0]!.name).toBe('Term');

      const decisionResults = searchNotes(db, '', 'decision');
      expect(decisionResults).toHaveLength(1);
      expect(decisionResults[0]!.name).toBe('Decide');

      db.close();
    });
  });

  describe('updateSymbolSummary', () => {
    it('sets symbols.summary for a matching card_path and symbols_au reindexes FTS', () => {
      const db = openDb(dbPath);

      upsertSymbol(db, {
        name: 'myFunc', kind: 'function', file_path: 'src/a.ts',
        line_start: 1, line_end: 10, signature: '', doc: 'Old doc', summary: '',
        card_path: '/cards/myFunc.md',
      });

      const result = updateSymbolSummary(db, '/cards/myFunc.md', 'A function that does X');
      expect(result).toBe(true);

      // Query FTS for the summary word — proves symbols_au trigger reindexed
      const syms = searchSymbols(db, 'does X', undefined, 10);
      expect(syms).toHaveLength(1);
      expect(syms[0]!.name).toBe('myFunc');
      expect(syms[0]!.summary).toBe('A function that does X');

      db.close();
    });

    it('returns false when no symbol matches card_path', () => {
      const db = openDb(dbPath);
      const result = updateSymbolSummary(db, '/nonexistent.md', 'summary');
      expect(result).toBe(false);
      db.close();
    });
  });

  describe('selectUnenrichedSymbols', () => {
    it('selects symbols with empty summary under a path prefix', () => {
      const db = openDb(dbPath);

      upsertSymbol(db, {
        name: 'enriched', kind: 'function', file_path: 'src/auth/token.ts',
        line_start: 1, line_end: 5, signature: '', doc: '', summary: 'Already done',
        card_path: '/cards/enriched.md',
      });
      upsertSymbol(db, {
        name: 'unenriched', kind: 'function', file_path: 'src/auth/token.ts',
        line_start: 10, line_end: 20, signature: '', doc: '', summary: '',
        card_path: '/cards/unenriched.md',
      });
      upsertSymbol(db, {
        name: 'other', kind: 'function', file_path: 'src/other/util.ts',
        line_start: 1, line_end: 1, signature: '', doc: '', summary: '',
        card_path: '/cards/other.md',
      });

      const results = selectUnenrichedSymbols(db, 'src/auth/', 10);
      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe('unenriched');
      expect(results[0]!.card_path).toBe('/cards/unenriched.md');

      db.close();
    });

    it('returns empty for a prefix with no unenriched symbols', () => {
      const db = openDb(dbPath);

      upsertSymbol(db, {
        name: 'done', kind: 'function', file_path: 'src/done.ts',
        line_start: 1, line_end: 1, signature: '', doc: '', summary: 'Has summary',
        card_path: '',
      });

      const results = selectUnenrichedSymbols(db, 'src/done.ts', 10);
      expect(results).toHaveLength(0);

      db.close();
    });

    it('respects limit parameter', () => {
      const db = openDb(dbPath);

      for (let i = 0; i < 5; i++) {
        upsertSymbol(db, {
          name: `sym${i}`, kind: 'function', file_path: 'src/a.ts',
          line_start: i, line_end: i, signature: '', doc: '', summary: '',
          card_path: '',
        });
      }

      const results = selectUnenrichedSymbols(db, 'src/', 3);
      expect(results).toHaveLength(3);

      db.close();
    });

    it('returns card_path, name, kind, file_path, line_start, line_end for each result', () => {
      const db = openDb(dbPath);

      upsertSymbol(db, {
        name: 'myFunc', kind: 'function', file_path: 'src/test.ts',
        line_start: 10, line_end: 20, signature: '', doc: '', summary: '',
        card_path: '/cards/test.md',
      });

      const results = selectUnenrichedSymbols(db, 'src/', 10);
      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe('myFunc');
      expect(results[0]!.kind).toBe('function');
      expect(results[0]!.file_path).toBe('src/test.ts');
      expect(results[0]!.line_start).toBe(10);
      expect(results[0]!.line_end).toBe(20);
      expect(results[0]!.card_path).toBe('/cards/test.md');

      db.close();
    });
  });

  describe('meta', () => {
    it('setMeta and getMeta round-trip values', () => {
      const db = openDb(dbPath);
      setMeta(db, 'last_indexed_commit', 'abc123');
      setMeta(db, 'schema_version', '1');

      expect(getMeta(db, 'last_indexed_commit')).toBe('abc123');
      expect(getMeta(db, 'schema_version')).toBe('1');
      expect(getMeta(db, 'nonexistent')).toBeNull();

      db.close();
    });

    it('setMeta overwrites existing values', () => {
      const db = openDb(dbPath);
      setMeta(db, 'key', 'first');
      setMeta(db, 'key', 'second');
      expect(getMeta(db, 'key')).toBe('second');
      db.close();
    });
  });
});
