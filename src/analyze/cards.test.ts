import { describe, it, expect } from 'vitest';
import { renderAnalysisCard, parseAnalysisCard } from './cards.ts';

describe('renderAnalysisCard', () => {
  it('renders a coverage finding as markdown with frontmatter', () => {
    const finding = {
      finding_kind: 'coverage' as const,
      title: 'Low coverage: src/auth/token.ts',
      severity: 'warn' as const,
      file_path: 'src/auth/token.ts',
      line_start: 0,
      line_end: 0,
      metric: '38% (24/63 lines)',
      body: 'Auth token refresh path is under-tested — 38% line coverage.',
      related: 'refreshToken, token.ts:42-71',
      card_path: '',
    };
    const card = renderAnalysisCard(finding);
    expect(card).toContain('---');
    expect(card).toContain('finding_kind: coverage');
    expect(card).toContain('title: Low coverage: src/auth/token.ts');
    expect(card).toContain('severity: warn');
    expect(card).toContain('location: src/auth/token.ts');
    expect(card).toContain('metric: 38% (24/63 lines)');
    expect(card).toContain('summary: Auth token refresh path is under-tested');
    expect(card).toContain('# Low coverage: src/auth/token.ts');
    expect(card).toContain('38% line coverage.');
  });

  it('renders a debt finding with correct fields', () => {
    const finding = {
      finding_kind: 'debt' as const,
      title: 'TODO: fix this',
      severity: 'info' as const,
      file_path: 'src/auth/handler.ts',
      line_start: 42,
      line_end: 42,
      metric: 'TODO',
      body: 'Need to handle edge case',
      related: '',
      card_path: '',
    };
    const card = renderAnalysisCard(finding);
    expect(card).toContain('finding_kind: debt');
    expect(card).toContain('TODO: fix this');
    expect(card).toContain('location: src/auth/handler.ts:42');
    expect(card).toContain('metric: TODO');
  });

  it('renders a practice finding', () => {
    const finding = {
      finding_kind: 'practice' as const,
      title: 'Missing error handling',
      severity: 'high' as const,
      file_path: 'src/api/route.ts',
      line_start: 15,
      line_end: 15,
      metric: '',
      body: 'This function does not handle rejected promises.',
      related: 'handleRequest, src/api/route.ts:10-30',
      card_path: '',
    };
    const card = renderAnalysisCard(finding);
    expect(card).toContain('finding_kind: practice');
    expect(card).toContain('severity: high');
    expect(card).toContain('handleRequest');
  });

  it('sanitizes newlines in frontmatter fields', () => {
    const finding = {
      finding_kind: 'debt' as const,
      title: 'TODO: fix this\nand that',
      severity: 'info' as const,
      file_path: 'src/a.ts',
      line_start: 1,
      line_end: 1,
      metric: 'TODO',
      body: 'Multi\nline\nbody',
      related: 'sym1\nsym2',
      card_path: '',
    };
    const card = renderAnalysisCard(finding);
    // Frontmatter should not contain literal newlines
    const frontmatter = card.split('---')[1] ?? '';
    expect(frontmatter).not.toContain('\n  '); // no indented continuation lines
    // Title in frontmatter should be flattened
    expect(frontmatter).toContain('fix this and that');
  });

  it('uses body first line as summary when body has no explicit summary field', () => {
    const finding = {
      finding_kind: 'coverage' as const,
      title: 'Test',
      severity: 'info' as const,
      file_path: 'src/a.ts',
      line_start: 0,
      line_end: 0,
      metric: '',
      body: 'First line is the summary.\nSecond line.',
      related: '',
      card_path: '',
    };
    const card = renderAnalysisCard(finding);
    expect(card).toContain('summary: First line is the summary.');
  });
});

describe('parseAnalysisCard', () => {
  it('parses a card rendered by renderAnalysisCard', () => {
    const finding = {
      finding_kind: 'coverage' as const,
      title: 'Low coverage: src/auth/token.ts',
      severity: 'warn' as const,
      file_path: 'src/auth/token.ts',
      line_start: 0,
      line_end: 0,
      metric: '38% (24/63 lines)',
      body: 'Auth token refresh path is under-tested.',
      related: 'refreshToken',
      card_path: '',
    };
    const card = renderAnalysisCard(finding);
    const parsed = parseAnalysisCard(card);
    expect(parsed).not.toBeNull();
    expect(parsed!.finding_kind).toBe('coverage');
    expect(parsed!.title).toBe('Low coverage: src/auth/token.ts');
    expect(parsed!.severity).toBe('warn');
    expect(parsed!.location).toBe('src/auth/token.ts');
    expect(parsed!.metric).toBe('38% (24/63 lines)');
    expect(parsed!.summary).toBe('Auth token refresh path is under-tested.');
  });

  it('returns null for a non-analysis card', () => {
    const text = `---
title: Something else
---
# Something`;
    const parsed = parseAnalysisCard(text);
    expect(parsed).toBeNull();
  });

  it('returns null for text without frontmatter', () => {
    const text = '# No frontmatter';
    const parsed = parseAnalysisCard(text);
    expect(parsed).toBeNull();
  });

  it('returns null when finding_kind is missing from frontmatter', () => {
    const text = `---
title: Test
---
# Test`;
    const parsed = parseAnalysisCard(text);
    expect(parsed).toBeNull();
  });
});
