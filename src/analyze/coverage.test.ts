import { describe, it, expect } from 'vitest';
import { parseLcov, parseCoverageJson, coverageSeverity } from './coverage.ts';

describe('parseLcov', () => {
  it('parses a simple lcov record with SF, DA, LF, LH', () => {
    const input = `SF:src/auth/token.ts
DA:1,1
DA:2,1
DA:3,0
DA:4,1
LF:4
LH:3
end_of_record`;
    const results = parseLcov(input);
    expect(results).toHaveLength(1);
    expect(results[0]!.file).toContain('src/auth/token.ts');
    expect(results[0]!.lines_total).toBe(4);
    expect(results[0]!.lines_covered).toBe(3);
    expect(results[0]!.pct).toBeCloseTo(75, 1);
  });

  it('parses multiple records', () => {
    const input = `SF:src/a.ts
DA:1,1
LF:1
LH:1
end_of_record
SF:src/b.ts
DA:1,0
LF:1
LH:0
end_of_record`;
    const results = parseLcov(input);
    expect(results).toHaveLength(2);
    expect(results[0]!.pct).toBe(100);
    expect(results[1]!.pct).toBe(0);
  });

  it('handles empty input gracefully', () => {
    const results = parseLcov('');
    expect(results).toEqual([]);
  });

  it('handles malformed input without throwing', () => {
    const results = parseLcov('not even close to lcov format');
    expect(results).toEqual([]);
  });

  it('handles records with 0 total lines', () => {
    const input = `SF:src/empty.ts
DA:1,1
LF:0
LH:0
end_of_record`;
    const results = parseLcov(input);
    expect(results).toHaveLength(1);
    expect(results[0]!.pct).toBe(100); // no lines = implicitly 100%
  });

  it('skips records with empty SF (no file path)', () => {
    const input = `SF:
DA:1,0
LF:1
LH:0
end_of_record`;
    const results = parseLcov(input);
    expect(results).toHaveLength(0);
  });
});

describe('parseCoverageJson', () => {
  it('parses a coverage-final.json with per-file data', () => {
    const input = {
      'src/auth/token.ts': {
        path: 'src/auth/token.ts',
        statementMap: {},
        fnMap: {},
        branchMap: {},
        s: { '0': 1, '1': 1, '2': 0 },
        f: {},
        b: {},
      },
    };
    const results = parseCoverageJson(input);
    expect(results).toHaveLength(1);
    expect(results[0]!.file).toContain('src/auth/token.ts');
    expect(results[0]!.lines_total).toBe(3);
    expect(results[0]!.lines_covered).toBe(2);
  });

  it('handles empty input', () => {
    const results = parseCoverageJson({});
    expect(results).toEqual([]);
  });

  it('handles null/undefined input gracefully', () => {
    const results = parseCoverageJson(null as any);
    expect(results).toEqual([]);
    const results2 = parseCoverageJson(undefined as any);
    expect(results2).toEqual([]);
  });

  it('handles files with no statements', () => {
    const input = {
      'src/empty.ts': {
        path: 'src/empty.ts',
        statementMap: {},
        fnMap: {},
        branchMap: {},
        s: {},
        f: {},
        b: {},
      },
    };
    const results = parseCoverageJson(input);
    expect(results).toHaveLength(1);
    expect(results[0]!.pct).toBe(100);
  });

  it('calculates percentage correctly', () => {
    const input = {
      'src/test.ts': {
        path: 'src/test.ts',
        statementMap: { '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } } },
        fnMap: {},
        branchMap: {},
        s: { '0': 0 },
        f: {},
        b: {},
      },
    };
    const results = parseCoverageJson(input);
    expect(results).toHaveLength(1);
    expect(results[0]!.pct).toBe(0);
    expect(results[0]!.lines_total).toBe(1);
    expect(results[0]!.lines_covered).toBe(0);
  });
});

describe('coverageSeverity', () => {
  it('returns "high" for <50%', () => {
    expect(coverageSeverity(0)).toBe('high');
    expect(coverageSeverity(25)).toBe('high');
    expect(coverageSeverity(49.9)).toBe('high');
  });

  it('returns "warn" for 50-80%', () => {
    expect(coverageSeverity(50)).toBe('warn');
    expect(coverageSeverity(65)).toBe('warn');
    expect(coverageSeverity(79.9)).toBe('warn');
  });

  it('returns "info" for >=80%', () => {
    expect(coverageSeverity(80)).toBe('info');
    expect(coverageSeverity(95)).toBe('info');
    expect(coverageSeverity(100)).toBe('info');
  });
});
