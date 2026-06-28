import { describe, it, expect } from 'vitest';
import { renderCard, parseCard, cardHead, updateCardSummary } from './cards.ts';
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

describe('updateCardSummary', () => {
  it('replaces frontmatter summary line and appends ## What it does section', () => {
    const card = `---
name: probeCompat
kind: function
signature: (cwd: string) => CompatResult
location: compat.ts:201-243
summary: Old summary
---

# probeCompat

Some body text here.
`;

    const updated = updateCardSummary(card, 'Detect whether minion & memory are active.');

    // Frontmatter summary updated
    expect(updated).toContain('summary: Detect whether minion & memory are active.');
    expect(updated).not.toContain('summary: Old summary');

    // ## What it does section added
    expect(updated).toContain('## What it does');
    expect(updated).toContain('Detect whether minion & memory are active.');
  });

  it('is idempotent — second apply does not stack duplicates', () => {
    const card = `---
name: probeCompat
kind: function
location: compat.ts:201-243
summary: Old
---

# probeCompat
`;

    const once = updateCardSummary(card, 'First summary.');
    const twice = updateCardSummary(once, 'Second summary.');

    // Has the new summary
    expect(twice).toContain('summary: Second summary.');
    expect(twice).not.toContain('summary: First summary.');

    // Only one ## What it does section
    const matches = twice.match(/## What it does/g);
    expect(matches).toHaveLength(1);

    // Only one summary in frontmatter
    const summaryMatches = twice.match(/^summary:/gm);
    expect(summaryMatches).toHaveLength(1);
  });

  it('handles empty summary in input', () => {
    const card = `---
name: foo
kind: function
location: foo.ts:1-10
summary:
---

# foo
`;

    const updated = updateCardSummary(card, 'New summary.');
    expect(updated).toContain('summary: New summary.');
    expect(updated).toContain('## What it does');
  });

  it('handles card with no existing body', () => {
    const card = `---
name: bar
kind: const
location: bar.ts:5-5
summary:
---
`;

    const updated = updateCardSummary(card, 'Just a constant.');
    expect(updated).toContain('summary: Just a constant.');
    expect(updated).toContain('## What it does');
  });

  it('does not break frontmatter for cards with tags field', () => {
    const card = `---
name: myFunc
kind: function
location: a.ts:1-10
tags: alpha, beta
summary:
---

# myFunc
`;

    const updated = updateCardSummary(card, 'A function that does something.');
    const parsed = parseCard(updated);
    expect(parsed).not.toBeNull();
    expect(parsed!.head.name).toBe('myFunc');
    expect(parsed!.head.summary).toBe('A function that does something.');
    expect(parsed!.head.tags).toEqual(['alpha', 'beta']);
  });

  it('round-trips through parseCard', () => {
    const card = `---
name: probeCompat
kind: function
location: compat.ts:201-243
summary: Old
---

# probeCompat
`;

    const updated = updateCardSummary(card, 'A function to detect integrations.');
    const parsed = parseCard(updated);
    expect(parsed).not.toBeNull();
    expect(parsed!.head.summary).toBe('A function to detect integrations.');
    expect(parsed!.body).toContain('A function to detect integrations.');
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
