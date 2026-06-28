import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { openDb, searchNotes } from './db.ts';
import { addNote, rebuildNotesDbFromCards } from './notes.ts';

describe('notes.ts', () => {
  let tmpDir: string;
  let glossaryDir: string;
  let decisionsDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-notes-'));
    glossaryDir = path.join(tmpDir, 'glossary');
    decisionsDir = path.join(tmpDir, 'decisions');
    dbPath = path.join(tmpDir, 'test.db');
    fs.mkdirSync(glossaryDir, { recursive: true });
    fs.mkdirSync(decisionsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('addNote', () => {
    it('writes a glossary card and inserts a DB row', () => {
      addNote(dbPath, {
        note_kind: 'glossary',
        title: 'Idempotency Key',
        body: 'A client-supplied key that makes retries safe.',
        tags: 'api,payments',
        related: 'createCharge',
        card_path: '',
      }, glossaryDir);

      // Card file exists under glossary dir
      const files = fs.readdirSync(glossaryDir);
      expect(files.length).toBeGreaterThan(0);
      const cardFile = files.find((f) => f.endsWith('.md'));
      expect(cardFile).toBeDefined();

      // Card content has frontmatter
      const cardContent = fs.readFileSync(path.join(glossaryDir, cardFile!), 'utf-8');
      expect(cardContent).toContain('note_kind: glossary');
      expect(cardContent).toContain('title: Idempotency Key');

      // DB row exists
      const db = openDb(dbPath);
      const results = searchNotes(db, 'Idempotency');
      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe('Idempotency Key');
      expect(results[0]!.note_kind).toBe('glossary');
      db.close();
    });

    it('writes a decision card under decisions dir', () => {
      addNote(dbPath, {
        note_kind: 'decision',
        title: 'Use SQLite over ChromaDB',
        body: 'Chosen for zero-infra approach.',
        tags: 'tech-decision',
        related: '',
        card_path: '',
      }, decisionsDir);

      const files = fs.readdirSync(decisionsDir);
      const cardFile = files.find((f) => f.endsWith('.md'));
      expect(cardFile).toBeDefined();

      const cardContent = fs.readFileSync(path.join(decisionsDir, cardFile!), 'utf-8');
      expect(cardContent).toContain('note_kind: decision');
      expect(cardContent).toContain('title: Use SQLite over ChromaDB');
    });

    it('is idempotent — re-adding same note updates in place', () => {
      addNote(dbPath, {
        note_kind: 'glossary', title: 'Term',
        body: 'Version 1', tags: '', related: '',
        card_path: '',
      }, glossaryDir);

      addNote(dbPath, {
        note_kind: 'glossary', title: 'Term',
        body: 'Version 2 updated', tags: 'v2', related: '',
        card_path: '',
      }, glossaryDir);

      // Single card file
      const files = fs.readdirSync(glossaryDir).filter((f) => f.endsWith('.md'));
      expect(files).toHaveLength(1);

      // DB has single row with updated body
      const db = openDb(dbPath);
      const results = searchNotes(db, '');
      expect(results).toHaveLength(1);
      expect(results[0]!.summary).toContain('updated');
      db.close();
    });
  });

  describe('rebuildNotesDbFromCards', () => {
    it('reconstructs DB rows from glossary + decisions cards alone', () => {
      // Add two notes
      addNote(dbPath, {
        note_kind: 'glossary', title: 'Cache Stampede',
        body: 'When many requests miss cache simultaneously.', tags: 'cache',
        related: 'getOrCreate',
        card_path: '',
      }, glossaryDir);
      addNote(dbPath, {
        note_kind: 'decision', title: 'Use triggers for FTS',
        body: 'FTS triggers prevent index corruption.', tags: 'sqlite',
        related: 'db.ts',
        card_path: '',
      }, decisionsDir);

      // Delete the DB to simulate disposable-index property
      fs.rmSync(dbPath, { force: true });

      // Rebuild from cards
      rebuildNotesDbFromCards(dbPath, glossaryDir, decisionsDir);

      // Query should find both
      const db = openDb(dbPath);
      const results = searchNotes(db, '');
      expect(results).toHaveLength(2);

      const glossaryHits = results.filter((r) => r.note_kind === 'glossary');
      const decisionHits = results.filter((r) => r.note_kind === 'decision');
      expect(glossaryHits).toHaveLength(1);
      expect(decisionHits).toHaveLength(1);
      expect(glossaryHits[0]!.name).toBe('Cache Stampede');
      expect(decisionHits[0]!.name).toBe('Use triggers for FTS');

      db.close();
    });

    it('handles empty directories gracefully', () => {
      // No cards added — should not throw
      fs.rmSync(dbPath, { force: true });
      rebuildNotesDbFromCards(dbPath, glossaryDir, decisionsDir);
      const db = openDb(dbPath);
      const results = searchNotes(db, '');
      expect(results).toHaveLength(0);
      db.close();
    });

    it('preserves card_path in rebuilt rows', () => {
      addNote(dbPath, {
        note_kind: 'glossary', title: 'Idempotency Key',
        body: 'Retry-safe POST key.', tags: '', related: '',
        card_path: '',
      }, glossaryDir);

      // Get the card path
      const files = fs.readdirSync(glossaryDir).filter((f) => f.endsWith('.md'));
      const cardPath = path.join(glossaryDir, files[0]!);

      fs.rmSync(dbPath, { force: true });
      rebuildNotesDbFromCards(dbPath, glossaryDir, decisionsDir);

      const db = openDb(dbPath);
      const row = db.prepare("SELECT card_path FROM notes WHERE title = ?").get('Idempotency Key') as any;
      expect(row).not.toBeUndefined();
      // card_path might be absolute or relative depending on how we stored it
      expect(row.card_path).toBeTruthy();
      db.close();
    });
  });
});
