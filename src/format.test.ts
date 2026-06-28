import { describe, it, expect } from 'vitest';
import { formatCompact, formatCardBody } from './format.ts';
import type { QueryResultRow, StalenessInfo } from './types.ts';

function makeLibRow(overrides: Partial<QueryResultRow> = {}): QueryResultRow {
  return {
    id: 100,
    name: 'createMiddleware',
    kind: 'function',
    file_path: 'hono/dist/helper.d.ts',
    line_start: 0,
    line_end: 0,
    signature: 'export declare function createMiddleware<E>(...): MiddlewareHandler',
    summary: 'Define a typed middleware handler.',
    score: 0.3,
    source: 'lib',
    lib: 'hono',
    version: '4.6.3',
    ...overrides,
  };
}

function makeRow(overrides: Partial<QueryResultRow> = {}): QueryResultRow {
  return {
    id: 1,
    name: 'myFunc',
    kind: 'function',
    file_path: 'src/util/helper.ts',
    line_start: 10,
    line_end: 20,
    signature: '(x: number) => string',
    summary: 'Does something useful with the input',
    score: 0.5,
    ...overrides,
  };
}

describe('formatCompact', () => {
  it('formats N rows into N compact lines', () => {
    const rows = [makeRow({ name: 'foo' }), makeRow({ name: 'bar', kind: 'class' })];
    const result = formatCompact(rows, null);
    expect(result).toContain('foo');
    expect(result).toContain('bar');
    expect(result).toContain('function');
    expect(result).toContain('class');
    expect(result).toContain('helper.ts:10-20');
  });

  it('truncates long summaries', () => {
    const longSummary = 'A'.repeat(200);
    const rows = [makeRow({ summary: longSummary })];
    const result = formatCompact(rows, null);
    // Summary should be truncated
    expect(result.length).toBeLessThan(400);
  });

  it('outputs capped at limit', () => {
    const rows = Array.from({ length: 20 }, (_, i) => makeRow({ name: `func${i}` }));
    const result = formatCompact(rows.slice(0, 5), null);
    expect(result).toContain('func0');
    expect(result).not.toContain('func10');
  });

  it('returns a friendly message for empty rows', () => {
    const result = formatCompact([], null);
    expect(result).toContain('No matches');
  });

  it('appends staleness note when present', () => {
    const staleness: StalenessInfo = {
      indexedCommit: 'abc123',
      headCommit: 'def456',
      changedFiles: 3,
      message: 'index stale',
    };
    const rows = [makeRow()];
    const result = formatCompact(rows, staleness);
    expect(result).toContain('index stale');
    expect(result).toContain('abc123');
    expect(result).toContain('def456');
  });
});

describe('formatCompact with lib rows', () => {
  it('renders a lib row with [lib@version] origin tag', () => {
    const rows = [makeLibRow()];
    const result = formatCompact(rows, null);
    expect(result).toContain('createMiddleware');
    expect(result).toContain('function');
    expect(result).toContain('[hono@4.6.3]');
    expect(result).toContain('Define a typed middleware handler.');
  });

  it('renders mixed code and lib rows', () => {
    const libRow = makeLibRow();
    const codeRow: QueryResultRow = {
      id: 1, name: 'myFunc', kind: 'function',
      file_path: 'src/util/helper.ts', line_start: 10, line_end: 20,
      signature: '(x: number) => string', summary: 'Does something', score: 0.5,
    };
    const result = formatCompact([codeRow, libRow], null);
    expect(result).toContain('helper.ts:10-20');
    expect(result).toContain('[hono@4.6.3]');
    // Two lines
    expect(result.split('\n')).toHaveLength(2);
  });

  it('bounded output for lib rows (one line per hit)', () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      makeLibRow({ name: `fn${i}`, lib: 'test-pkg', version: '1.0.0' })
    );
    const result = formatCompact(rows, null);
    expect(result.split('\n')).toHaveLength(5);
    expect(result).toContain('[test-pkg@1.0.0]');
  });
});

describe('formatCompact with note rows', () => {
  it('renders a glossary note row with [glossary] prefix', () => {
    const rows: QueryResultRow[] = [{
      id: 1, name: 'Idempotency Key', kind: 'glossary',
      file_path: '', line_start: 0, line_end: 0,
      signature: '', summary: 'A client-supplied key that makes retries safe.',
      score: 0.5, source: 'note', note_kind: 'glossary', tags: 'api',
    }];
    const result = formatCompact(rows, null);
    expect(result).toContain('Idempotency Key');
    expect(result).toContain('glossary');
    expect(result).toContain('[glossary]');
    expect(result).toContain('A client-supplied key that makes retries safe.');
  });

  it('renders a decision note row with [decision] prefix', () => {
    const rows: QueryResultRow[] = [{
      id: 1, name: 'Use SQLite', kind: 'decision',
      file_path: '', line_start: 0, line_end: 0,
      signature: '', summary: 'Chosen for zero infra.',
      score: 0.5, source: 'note', note_kind: 'decision', tags: '',
    }];
    const result = formatCompact(rows, null);
    expect(result).toContain('Use SQLite');
    expect(result).toContain('decision');
    expect(result).toContain('[decision]');
  });

  it('renders mixed code + lib + note rows all on separate lines', () => {
    const codeRow: QueryResultRow = {
      id: 1, name: 'myFunc', kind: 'function',
      file_path: 'src/util/helper.ts', line_start: 10, line_end: 20,
      signature: '', summary: 'Does something', score: 0.5,
    };
    const libRow = makeLibRow();
    const noteRow: QueryResultRow = {
      id: 1, name: 'Retry Key', kind: 'glossary',
      file_path: '', line_start: 0, line_end: 0,
      signature: '', summary: 'Key for idempotent retries.',
      score: 0.5, source: 'note', note_kind: 'glossary', tags: '',
    };

    const result = formatCompact([codeRow, libRow, noteRow], null);
    expect(result).toContain('helper.ts:10-20');
    expect(result).toContain('[hono@4.6.3]');
    expect(result).toContain('[glossary]');
    expect(result).toContain('Retry Key');
    expect(result.split('\n')).toHaveLength(3);
  });
});

describe('formatCardBody', () => {
  it('returns the card body text', () => {
    const body = '# myFunc\n\nDoes something.\n';
    expect(formatCardBody(body)).toContain('Does something.');
  });
});
