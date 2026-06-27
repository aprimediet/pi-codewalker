import { describe, it, expect } from 'vitest';
import { formatCompact, formatCardBody } from './format.ts';
import type { QueryResultRow, StalenessInfo } from './types.ts';

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

describe('formatCardBody', () => {
  it('returns the card body text', () => {
    const body = '# myFunc\n\nDoes something.\n';
    expect(formatCardBody(body)).toContain('Does something.');
  });
});
