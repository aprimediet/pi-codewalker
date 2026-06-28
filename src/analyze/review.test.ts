import { describe, it, expect } from 'vitest';
import {
  validateReviewPath,
  checkReviewCap,
  selectFilesForReview,
  formatReviewWorklist,
  DEFAULT_REVIEW_CAP,
} from './review.ts';

describe('validateReviewPath', () => {
  it('accepts a non-empty path', () => {
    const result = validateReviewPath('src/auth');
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('rejects empty string', () => {
    const result = validateReviewPath('');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Specify a path');
  });

  it('rejects whitespace-only', () => {
    const result = validateReviewPath('   ');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Specify a path');
  });

  it('rejects undefined/null', () => {
    const result = validateReviewPath(undefined as any);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Specify a path');
  });
});

describe('checkReviewCap', () => {
  it('returns ok when count within cap', () => {
    const result = checkReviewCap(5, 25);
    expect(result.ok).toBe(true);
    expect(result.count).toBe(5);
    expect(result.skipped).toBe(0);
    expect(result.error).toBeUndefined();
  });

  it('rejects when count exceeds cap', () => {
    const result = checkReviewCap(100, 25);
    expect(result.ok).toBe(false);
    expect(result.count).toBe(100);
    expect(result.skipped).toBe(75);
    expect(result.error).toContain('Narrow your path');
  });

  it('uses default cap when not specified', () => {
    const result = checkReviewCap(50);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('--max');
  });

  it('accepts edge case at exactly cap', () => {
    const result = checkReviewCap(25, 25);
    expect(result.ok).toBe(true);
    expect(result.count).toBe(25);
  });
});

describe('selectFilesForReview', () => {
  const files = [
    'src/auth/token.ts',
    'src/auth/session.ts',
    'src/api/route.ts',
    'src/api/handler.ts',
    'src/db/query.ts',
  ];

  it('selects files under a path prefix', () => {
    const result = selectFilesForReview(files, 'src/auth', 25);
    expect(result).toHaveLength(2);
    expect(result).toContain('src/auth/token.ts');
    expect(result).toContain('src/auth/session.ts');
  });

  it('respects the cap', () => {
    const result = selectFilesForReview(files, 'src/', 3);
    expect(result).toHaveLength(3);
  });

  it('returns empty array for non-matching prefix', () => {
    const result = selectFilesForReview(files, 'src/nonexistent', 25);
    expect(result).toEqual([]);
  });

  it('returns all matching files when under cap', () => {
    const result = selectFilesForReview(files, 'src/api', 25);
    expect(result).toHaveLength(2);
  });

  it('returns exact cap when match count equals cap', () => {
    const result = selectFilesForReview(files, '', 5);
    expect(result).toHaveLength(5);
  });
});

describe('formatReviewWorklist', () => {
  it('formats a worklist with file list and instructions', () => {
    const files = ['src/auth/token.ts', 'src/auth/session.ts'];
    const result = formatReviewWorklist(files, 'src/auth');
    expect(result).toContain('2 file(s) under');
    expect(result).toContain('src/auth');
    expect(result).toContain('src/auth/token.ts');
    expect(result).toContain('src/auth/session.ts');
    expect(result).toContain('codewalker_finding');
    expect(result).toContain('conventions');
    expect(result).toContain('decisions');
  });

  it('handles empty file list', () => {
    const result = formatReviewWorklist([], 'src/auth');
    expect(result).toContain('No files found');
  });

  it('includes the max files info when files hit the cap', () => {
    const files = Array.from({ length: 25 }, (_, i) => `src/a${i}.ts`);
    const result = formatReviewWorklist(files, 'src/');
    expect(result).toContain('25');
    expect(result).toContain('selected for review');
  });
});
