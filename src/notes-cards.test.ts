import { describe, it, expect } from 'vitest';
import { renderNoteCard, parseNoteCard } from './notes-cards.ts';
import type { Note } from './types.ts';

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    note_kind: 'glossary',
    title: 'Idempotency Key',
    body: 'A client-supplied key that makes a retried POST safe to replay.',
    tags: 'api, payments',
    related: 'createCharge, charge.ts:88-140',
    card_path: '',
    ...overrides,
  };
}

describe('renderNoteCard', () => {
  it('renders a glossary note with frontmatter head', () => {
    const note = makeNote();
    const md = renderNoteCard(note);

    expect(md).toContain('---');
    expect(md).toContain('note_kind: glossary');
    expect(md).toContain('title: Idempotency Key');
    expect(md).toContain('tags: api, payments');
    expect(md).toContain('related: createCharge, charge.ts:88-140');
    expect(md).toContain('summary: A client-supplied key that makes a retried POST safe to replay.');

    // Body
    expect(md).toContain('# Idempotency Key');
    expect(md).toContain(note.body);
  });

  it('renders a decision note', () => {
    const note = makeNote({
      note_kind: 'decision',
      title: 'Use SQLite over ChromaDB',
      body: 'We chose SQLite+FTS5 because the agent can expand queries itself.',
      tags: 'tech-decision, database',
      related: 'docs/tech-decision.md',
    });
    const md = renderNoteCard(note);
    expect(md).toContain('note_kind: decision');
    expect(md).toContain('title: Use SQLite over ChromaDB');
    expect(md).toContain('tags: tech-decision, database');
    expect(md).toContain('related: docs/tech-decision.md');
    expect(md).toContain('# Use SQLite over ChromaDB');
    expect(md).toContain(note.body);
  });

  it('sanitizes newlines in head fields', () => {
    const note = makeNote({
      title: 'Multi\nline',
    });

    const md = renderNoteCard(note);
    // title should not have raw newlines in frontmatter
    const fmMatch = md.match(/^title: (.+)$/m);
    expect(fmMatch).not.toBeNull();
    expect(fmMatch![1]!).not.toContain('\n');
  });

  it('uses body first line as summary', () => {
    const note = makeNote();
    const md = renderNoteCard(note);
    // The first line of body should appear as summary
    expect(md).toContain('summary: A client-supplied key that makes a retried POST safe to replay.');
  });
});

describe('parseNoteCard', () => {
  it('round-trips renderNoteCard -> parseNoteCard preserving head fields', () => {
    const note = makeNote();
    const md = renderNoteCard(note);
    const parsed = parseNoteCard(md);
    expect(parsed).not.toBeNull();
    expect(parsed!.note_kind).toBe('glossary');
    expect(parsed!.title).toBe('Idempotency Key');
    expect(parsed!.tags).toBe('api, payments');
    expect(parsed!.related).toBe('createCharge, charge.ts:88-140');
    // summary from body first line
    expect(parsed!.summary).toBeTruthy();
  });

  it('returns null for invalid markdown', () => {
    expect(parseNoteCard('no frontmatter')).toBeNull();
    expect(parseNoteCard('')).toBeNull();
  });

  it('returns null for card without note_kind in frontmatter', () => {
    const md = `---
name: foo
kind: function
---
# foo
`;
    expect(parseNoteCard(md)).toBeNull();
  });
});
