import { describe, it, expect } from 'vitest';
import { renderCard, parseCard, cardHead } from './cards.ts';
import type { Symbol } from './types.ts';

function makeSymbol(overrides: Partial<Symbol> = {}): Symbol {
  return {
    name: 'probeCompat',
    kind: 'function',
    file_path: '/root/src/compat.ts',
    line_start: 201,
    line_end: 243,
    signature: '(cwd: string) => CompatResult',
    doc: 'Detect whether minion & memory are active for the project at cwd.',
    summary: '',
    card_path: '',
    ...overrides,
  };
}

describe('renderCard', () => {
  it('renders a symbol as a markdown card with frontmatter head and body', () => {
    const sym = makeSymbol();
    const md = renderCard(sym);

    // Head (frontmatter)
    expect(md).toContain('---');
    expect(md).toContain('name: probeCompat');
    expect(md).toContain('kind: function');
    expect(md).toContain('signature: (cwd: string) => CompatResult');
    expect(md).toContain('location: compat.ts:201-243');
    expect(md).toContain('summary: Detect whether minion & memory are active for the project at cwd.');

    // Body
    expect(md).toContain('# probeCompat');
    expect(md).toContain(sym.doc);
  });

  it('uses relative path (basename only) for location', () => {
    const sym = makeSymbol({ file_path: '/very/deep/src/util/helper.ts', line_start: 5, line_end: 10 });
    const md = renderCard(sym);
    expect(md).toContain('location: helper.ts:5-10');
  });

  it('handles empty doc gracefully', () => {
    const sym = makeSymbol({ doc: '' });
    const md = renderCard(sym);
    expect(md).toContain('name: probeCompat');
    expect(md).toContain('# probeCompat');
    // Body may be empty
  });
});

describe('parseCard', () => {
  it('round-trips renderCard → parseCard preserving head fields', () => {
    const sym = makeSymbol();
    const md = renderCard(sym);
    const parsed = parseCard(md);
    expect(parsed).not.toBeNull();
    expect(parsed!.head.name).toBe('probeCompat');
    expect(parsed!.head.kind).toBe('function');
    expect(parsed!.head.signature).toBe('(cwd: string) => CompatResult');
    expect(parsed!.head.location).toBe('compat.ts:201-243');
    expect(parsed!.head.summary).toContain('minion');
    // Body contains the doc text
    expect(parsed!.body).toContain(sym.doc);
  });

  it('returns null for invalid markdown', () => {
    expect(parseCard('not frontmatter')).toBeNull();
    expect(parseCard('')).toBeNull();
  });
});

describe('cardHead', () => {
  it('returns only the frontmatter head from a card', () => {
    const sym = makeSymbol();
    const md = renderCard(sym);
    const head = cardHead(md);
    expect(head).not.toBeNull();
    expect(head!.name).toBe('probeCompat');
    expect(head!.kind).toBe('function');
    expect(head!.location).toBe('compat.ts:201-243');
  });

  it('returns null for invalid input', () => {
    expect(cardHead('no frontmatter here')).toBeNull();
  });
});
