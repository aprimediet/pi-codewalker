import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { openDb, bootstrapDb, upsertSymbol, searchSymbols, getMeta, setMeta, deleteFileSymbols } from './db.ts';

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

    it('sets user_version to 1', () => {
      const db = new Database(dbPath);
      bootstrapDb(db);
      const version = db.pragma('user_version', { simple: true }) as number;
      expect(version).toBe(1);
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
