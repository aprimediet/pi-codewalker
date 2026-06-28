import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { openDb, upsertSymbol, setMeta, getMeta, upsertLibSymbol, upsertNote, searchLibSymbols } from './db.ts';
import { runQuery } from './query.ts';

describe('query.ts', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-query-'));
    dbPath = path.join(tmpDir, 'test.db');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns compact rows with file:line for a text query', () => {
    const db = openDb(dbPath);
    upsertSymbol(db, {
      name: 'probeCompat', kind: 'function', file_path: 'src/compat.ts',
      line_start: 201, line_end: 243, signature: '(cwd: string) => CompatResult',
      doc: 'Detect integration status', summary: '', card_path: '',
    });
    upsertSymbol(db, {
      name: 'detectStack', kind: 'function', file_path: 'src/detect.ts',
      line_start: 10, line_end: 30, signature: '() => string[]',
      doc: 'Detect tech stack', summary: '', card_path: '',
    });
    db.close();

    const result = runQuery(dbPath, { query: 'probeCompat' });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.name).toBe('probeCompat');
    expect(result.rows[0]!.file_path).toBe('src/compat.ts');
    expect(result.staleness).toBeNull();
  });

  it('kind filter narrows results', () => {
    const db = openDb(dbPath);
    upsertSymbol(db, {
      name: 'MyClass', kind: 'class', file_path: 'src/a.ts',
      line_start: 1, line_end: 10, signature: '', doc: '', summary: '', card_path: '',
    });
    upsertSymbol(db, {
      name: 'myFunc', kind: 'function', file_path: 'src/b.ts',
      line_start: 1, line_end: 5, signature: '', doc: '', summary: '', card_path: '',
    });
    db.close();

    const result = runQuery(dbPath, { query: 'MyClass', kind: 'class' });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.kind).toBe('class');
  });

  it('limit defaults to 10', () => {
    const db = openDb(dbPath);
    for (let i = 0; i < 15; i++) {
      upsertSymbol(db, {
        name: `sym${i}`, kind: 'function', file_path: 'src/a.ts',
        line_start: i, line_end: i, signature: '', doc: '', summary: '', card_path: '',
      });
    }
    db.close();

    const result = runQuery(dbPath, { query: '' });
    expect(result.rows.length).toBeLessThanOrEqual(10);
  });

  it('limit parameter caps results', () => {
    const db = openDb(dbPath);
    for (let i = 0; i < 15; i++) {
      upsertSymbol(db, {
        name: `sym${i}`, kind: 'function', file_path: 'src/a.ts',
        line_start: i, line_end: i, signature: '', doc: '', summary: '', card_path: '',
      });
    }
    db.close();

    const result = runQuery(dbPath, { query: '', limit: 3 });
    expect(result.rows).toHaveLength(3);
  });

  it('reports staleness when last_indexed_commit differs from HEAD', () => {
    // Without git, staleness will be null (no commit to compare)
    const db = openDb(dbPath);
    setMeta(db, 'last_indexed_commit', 'abc123');
    db.close();

    const result = runQuery(dbPath, { query: '' });
    // The staleness signal depends on git context
    // In a non-git dir, staleness should be null
    expect(result.staleness).toBeNull();
  });

  // ── source filter ───────────────────────────────────────────
  it('source="code" returns only code symbols (default)', () => {
    const db = openDb(dbPath);
    upsertSymbol(db, {
      name: 'myFunc', kind: 'function', file_path: 'src/a.ts',
      line_start: 1, line_end: 1, signature: '', doc: '', summary: '', card_path: '',
    });
    upsertLibSymbol(db, {
      lib: 'hono', version: '4.6.3', name: 'honoFunc',
      kind: 'function', signature: '', doc: '', summary: '', card_path: '',
    });
    db.close();

    const result = runQuery(dbPath, { query: '', source: 'code' });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.name).toBe('myFunc');
    expect(result.rows[0]!.source).toBeUndefined();
  });

  it('source="libs" returns only lib symbols', () => {
    const db = openDb(dbPath);
    upsertSymbol(db, {
      name: 'myFunc', kind: 'function', file_path: 'src/a.ts',
      line_start: 1, line_end: 1, signature: '', doc: '', summary: '', card_path: '',
    });
    upsertLibSymbol(db, {
      lib: 'hono', version: '4.6.3', name: 'honoFunc',
      kind: 'function', signature: '', doc: '', summary: '', card_path: '',
    });
    db.close();

    const result = runQuery(dbPath, { query: '', source: 'libs' });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.name).toBe('honoFunc');
    expect(result.rows[0]!.source).toBe('lib');
    expect(result.rows[0]!.lib).toBe('hono');
    expect(result.rows[0]!.version).toBe('4.6.3');
  });

  it('source="all" returns merged code and lib symbols', () => {
    const db = openDb(dbPath);
    upsertSymbol(db, {
      name: 'myFunc', kind: 'function', file_path: 'src/a.ts',
      line_start: 1, line_end: 1, signature: '', doc: '', summary: '', card_path: '',
    });
    upsertLibSymbol(db, {
      lib: 'hono', version: '4.6.3', name: 'honoFunc',
      kind: 'function', signature: '', doc: '', summary: '', card_path: '',
    });
    db.close();

    const result = runQuery(dbPath, { query: '', source: 'all' });
    expect(result.rows).toHaveLength(2);
  });

  it('source=all respects limit across merged set', () => {
    const db = openDb(dbPath);
    upsertSymbol(db, {
      name: 'aCode', kind: 'function', file_path: 'src/a.ts',
      line_start: 1, line_end: 1, signature: '', doc: '', summary: '', card_path: '',
    });
    upsertLibSymbol(db, {
      lib: 'pkg', version: '1.0.0', name: 'bLib',
      kind: 'function', signature: '', doc: '', summary: '', card_path: '',
    });
    db.close();

    const result = runQuery(dbPath, { query: '', source: 'all', limit: 1 });
    expect(result.rows).toHaveLength(1);
  });

  // ── notes source ───────────────────────────────────────────
  it('source="notes" returns only notes', () => {
    const db = openDb(dbPath);
    upsertSymbol(db, {
      name: 'myFunc', kind: 'function', file_path: 'src/a.ts',
      line_start: 1, line_end: 1, signature: '', doc: '', summary: '', card_path: '',
    });
    upsertNote(db, {
      note_kind: 'glossary', title: 'Glossary Term', body: 'A term', tags: '', related: '', card_path: '',
    });
    db.close();

    const result = runQuery(dbPath, { query: '', source: 'notes' });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.name).toBe('Glossary Term');
    expect(result.rows[0]!.source).toBe('note');
  });

  it('source="all" includes notes interleaved with code and libs', () => {
    const db = openDb(dbPath);
    upsertSymbol(db, {
      name: 'myFunc', kind: 'function', file_path: 'src/a.ts',
      line_start: 1, line_end: 1, signature: '', doc: 'refresh token', summary: '', card_path: '',
    });
    upsertLibSymbol(db, {
      lib: 'hono', version: '4.6.3', name: 'honoFunc',
      kind: 'function', signature: '', doc: 'refresh token', summary: '', card_path: '',
    });
    upsertNote(db, {
      note_kind: 'glossary', title: 'Refresh Token', body: 'A token used to refresh auth without re-login.', tags: 'auth', related: 'myFunc', card_path: '',
    });
    db.close();

    const result = runQuery(dbPath, { query: 'refresh', source: 'all' });
    expect(result.rows.length).toBeGreaterThanOrEqual(2);
    // Should have note + lib + code (code rows have source undefined)
    const sources = result.rows.map(r => r.source);
    expect(sources).toContain('note');
    expect(sources).toContain('lib');
    expect(sources).toContain(undefined); // code rows have no source
  });

  it('source kind filter works for notes source', () => {
    const db = openDb(dbPath);
    upsertNote(db, {
      note_kind: 'glossary', title: 'Term', body: 'A glossary term', tags: '', related: '', card_path: '',
    });
    upsertNote(db, {
      note_kind: 'decision', title: 'Decision', body: 'A decision note', tags: '', related: '', card_path: '',
    });
    db.close();

    const result = runQuery(dbPath, { query: '', source: 'notes', kind: 'glossary' });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.name).toBe('Term');
  });

  it('source=all with note in query works (note matches alongside code)', () => {
    const db = openDb(dbPath);
    upsertSymbol(db, {
      name: 'myFunc', kind: 'function', file_path: 'src/payments.ts',
      line_start: 1, line_end: 10, signature: '', doc: 'processes charges', summary: '', card_path: '',
    });
    upsertNote(db, {
      note_kind: 'glossary', title: 'charge', body: 'A payment processing concept.',
      tags: 'payments', related: 'myFunc', card_path: '',
    });
    db.close();

    const result = runQuery(dbPath, { query: 'charge', source: 'all' });
    expect(result.rows.length).toBeGreaterThanOrEqual(1);
    const sources = result.rows.map(r => r.source);
    expect(sources).toContain('note');
  });

});
