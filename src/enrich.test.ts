import { describe, it, expect } from 'vitest';
import { formatEnrichWorklist, validateEnrichPath, checkEnrichCap } from './enrich.ts';
import type { UnenrichedSymbol } from './enrich.ts';

function makeSym(overrides: Partial<UnenrichedSymbol> = {}): UnenrichedSymbol {
  return {
    name: 'myFunc',
    kind: 'function',
    file_path: 'src/auth/token.ts',
    line_start: 10,
    line_end: 30,
    card_path: '/entries/symbols/auth-token/myFunc.md',
    ...overrides,
  };
}

describe('validateEnrichPath', () => {
  it('accepts a non-empty path', () => {
    const result = validateEnrichPath('src/auth');
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('rejects empty string', () => {
    const result = validateEnrichPath('');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('specify a path');
  });

  it('rejects whitespace-only', () => {
    const result = validateEnrichPath('   ');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('specify a path');
  });

  it('rejects undefined/null', () => {
    const result = validateEnrichPath(undefined as any);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('specify a path');
  });
});

describe('checkEnrichCap', () => {
  it('returns ok when count within cap', () => {
    const result = checkEnrichCap(5, 40);
    expect(result.ok).toBe(true);
    expect(result.count).toBe(5);
    expect(result.skipped).toBe(0);
    expect(result.error).toBeUndefined();
  });

  it('rejects when count exceeds cap', () => {
    const result = checkEnrichCap(100, 40);
    expect(result.ok).toBe(false);
    expect(result.count).toBe(100);
    expect(result.skipped).toBe(60);
    expect(result.error).toContain('100 symbols');
    expect(result.error).toContain('--max=100');
  });

  it('uses default cap when not specified', () => {
    const result = checkEnrichCap(50);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('--max=50');
  });

  it('accepts edge case at exactly cap', () => {
    const result = checkEnrichCap(40, 40);
    expect(result.ok).toBe(true);
    expect(result.count).toBe(40);
  });
});

describe('formatEnrichWorklist', () => {
  it('formats symbols into compact lines', () => {
    const syms = [
      makeSym({ name: 'refreshToken', file_path: 'src/auth/token.ts', line_start: 42, line_end: 71 }),
      makeSym({ name: 'validateJwt', file_path: 'src/auth/jwt.ts', line_start: 10, line_end: 30 }),
    ];

    const result = formatEnrichWorklist(syms, 'src/auth');
    expect(result).toContain('refreshToken');
    expect(result).toContain('validateJwt');
    expect(result).toContain('src/auth');
    expect(result).toContain('42-71');
    expect(result).toContain('10-30');
    expect(result).toMatch(/function/g);
  });

  it('includes instructions for the agent', () => {
    const syms = [makeSym()];
    const result = formatEnrichWorklist(syms, 'src/');
    expect(result).toContain('codewalker_enrich');
    expect(result).toContain('summary');
    expect(result).toContain('120');
  });

  it('says "No unenriched symbols" for empty array', () => {
    const result = formatEnrichWorklist([], 'src/');
    expect(result).toContain('No unenriched symbols');
  });
});
