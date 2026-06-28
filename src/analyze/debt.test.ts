import { describe, it, expect } from 'vitest';
import { scanDebt, LARGE_FILE_LINES, LONG_FN_LINES } from './debt.ts';
import type { DebtFinding } from './debt.ts';

describe('scanDebt', () => {
  it('finds TODO markers with correct line numbers', () => {
    const content = `// normal line
const x = 1;
// TODO: fix this
function y() {} // TODO: refactor later
`;
    const findings = scanDebt('src/a.ts', content, []);
    const todos = findings.filter(f => f.marker === 'TODO');
    expect(todos).toHaveLength(2);
    expect(todos[0]!.line_start).toBe(3);
    expect(todos[1]!.line_start).toBe(4);
  });

  it('finds FIXME markers', () => {
    const content = `// FIXME: this is broken
const x = 1;
`;
    const findings = scanDebt('src/a.ts', content, []);
    const fixmes = findings.filter(f => f.marker === 'FIXME');
    expect(fixmes).toHaveLength(1);
    expect(fixmes[0]!.line_start).toBe(1);
  });

  it('finds HACK markers', () => {
    const content = `// HACK: workaround for edge case
const x = 1;
`;
    const findings = scanDebt('src/a.ts', content, []);
    const hacks = findings.filter(f => f.marker === 'HACK');
    expect(hacks).toHaveLength(1);
  });

  it('finds XXX markers', () => {
    const content = `// XXX: this needs attention
const x = 1;
`;
    const findings = scanDebt('src/a.ts', content, []);
    const xxxs = findings.filter(f => f.marker === 'XXX');
    expect(xxxs).toHaveLength(1);
  });

  it('counts @ts-ignore occurrences', () => {
    const content = `// @ts-ignore
const x: any = 1;
// @ts-ignore — next line
const y: any = 2;
`;
    const findings = scanDebt('src/a.ts', content, []);
    const tsIgnores = findings.filter(f => f.marker === '@ts-ignore');
    expect(tsIgnores).toHaveLength(2);
  });

  it('counts @ts-nocheck occurrences', () => {
    const content = `// @ts-nocheck
const x = 1;
`;
    const findings = scanDebt('src/a.ts', content, []);
    const tsNocheck = findings.filter(f => f.marker === '@ts-nocheck');
    expect(tsNocheck).toHaveLength(1);
  });

  it('flags a file as oversized when lines exceed LARGE_FILE_LINES', () => {
    const content = Array.from({ length: LARGE_FILE_LINES + 50 }, (_, i) =>
      `line ${i + 1}`
    ).join('\n');
    const findings = scanDebt('src/large.ts', content, []);
    const oversize = findings.filter(f => f.marker === 'oversized-file');
    expect(oversize).toHaveLength(1);
    expect(oversize[0]!.severity).toBe('warn');
    expect(oversize[0]!.metric).toContain(String(LARGE_FILE_LINES + 50));
  });

  it('does NOT flag a file under the limit', () => {
    const content = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n');
    const findings = scanDebt('src/small.ts', content, []);
    const oversize = findings.filter(f => f.marker === 'oversized-file');
    expect(oversize).toHaveLength(0);
  });

  it('flags functions longer than LONG_FN_LINES using existing symbol spans', () => {
    const symbols = [
      { name: 'longFunc', kind: 'function', file_path: 'src/big.ts', line_start: 1, line_end: LONG_FN_LINES + 50 },
      { name: 'shortFunc', kind: 'function', file_path: 'src/big.ts', line_start: 200, line_end: 210 },
    ];
    const content = '';
    const findings = scanDebt('src/big.ts', content, symbols);
    const longFn = findings.filter(f => f.marker === 'long-function');
    expect(longFn).toHaveLength(1);
    expect(longFn[0]!.title).toContain('longFunc');
    expect(longFn[0]!.severity).toBe('warn');
  });

  it('returns empty array for clean file', () => {
    const content = `const x = 1;
const y = 2;
function foo() { return x + y; }
`;
    const findings = scanDebt('src/clean.ts', content, []);
    expect(findings).toHaveLength(0);
  });

  it('handles empty content', () => {
    const findings = scanDebt('src/empty.ts', '', []);
    expect(findings).toEqual([]);
  });
});
