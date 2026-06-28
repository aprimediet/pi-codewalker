import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import crypto from 'node:crypto';

// We'll test project.ts after writing the test

describe('project.ts', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-project-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('slug + id algorithm', () => {
    it('generates a deterministic id from project root: slug(basename)-sha1(absRoot)[:8]', async () => {
      const mod = await import('./project.ts');
      const p = mod.resolveProject(tmpDir);
      // slug = basename lowercased, non-alphanumeric → '-'
      const basename = path.basename(tmpDir).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';
      const hash = crypto.createHash('sha1').update(tmpDir).digest('hex').slice(0, 8);
      const expectedId = `${basename}-${hash}`;
      expect(p.id).toBe(expectedId);
    });

    it('reuses an existing .pi/<id>.md marker id (marker-wins)', async () => {
      const configDir = path.join(tmpDir, '.pi');
      fs.mkdirSync(configDir, { recursive: true });
      const markerId = 'my-project-a1b2c3d4';
      const markerPath = path.join(configDir, `${markerId}.md`);
      fs.writeFileSync(markerPath, `---\npi-project: true\nid: ${markerId}\n---\n# marker\n`, 'utf-8');

      const mod = await import('./project.ts');
      const p = mod.resolveProject(tmpDir);
      expect(p.id).toBe(markerId);
      expect(p.markerPath).toBe(markerPath);
    });
  });

  describe('findProjectRoot', () => {
    it('walks up from cwd to find .git', async () => {
      const gitDir = path.join(tmpDir, 'sub', 'dir');
      fs.mkdirSync(gitDir, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.git'), '');
      const mod = await import('./project.ts');
      // We need to call resolveProject from within sub/dir
      const p = mod.resolveProject(gitDir);
      expect(p.root).toBe(tmpDir);
    });

    it('walks up from cwd to find .pi config dir', async () => {
      const piDir = path.join(tmpDir, 'deep', 'nested');
      fs.mkdirSync(piDir, { recursive: true });
      fs.mkdirSync(path.join(tmpDir, '.pi'), { recursive: true });
      const mod = await import('./project.ts');
      const p = mod.resolveProject(piDir);
      expect(p.root).toBe(tmpDir);
    });

    it('returns cwd when no marker or .git is found', async () => {
      const isolated = path.join(tmpDir, 'isolated');
      fs.mkdirSync(isolated, { recursive: true });
      const mod = await import('./project.ts');
      const p = mod.resolveProject(isolated);
      expect(p.root).toBe(isolated);
    });
  });

  describe('ProjectPaths', () => {
    it('resolves codewalker paths under ~/.pi/projects/<id>/codewalker/', async () => {
      const mod = await import('./project.ts');
      const p = mod.resolveProject(tmpDir);
      expect(p.codewalkerDir).toContain(path.join('projects', p.id, 'codewalker'));
      expect(p.dbPath).toBe(path.join(p.codewalkerDir, 'index.db'));
      expect(p.metaFile).toBe(path.join(p.codewalkerDir, 'meta.json'));
      expect(p.entriesDir).toBe(path.join(p.codewalkerDir, 'entries'));
      expect(p.symbolsDir).toBe(path.join(p.codewalkerDir, 'entries', 'symbols'));
      expect(p.libsDir).toBe(path.join(p.codewalkerDir, 'entries', 'libs'));
    });

    it('exposes glossaryDir and decisionsDir paths', async () => {
      const mod = await import('./project.ts');
      const p = mod.resolveProject(tmpDir);
      expect(p.glossaryDir).toBe(path.join(p.codewalkerDir, 'entries', 'glossary'));
      expect(p.decisionsDir).toBe(path.join(p.codewalkerDir, 'entries', 'decisions'));
    });

    it('exposes analysisDir and conventionsDir paths', async () => {
      const mod = await import('./project.ts');
      const p = mod.resolveProject(tmpDir);
      expect(p.analysisDir).toBe(path.join(p.codewalkerDir, 'entries', 'analysis'));
      expect(p.conventionsDir).toBe(path.join(p.codewalkerDir, 'entries', 'conventions'));
    });
  });

  describe('ensureProject', () => {
    it('creates the codewalker directory structure and returns paths', async () => {
      const mod = await import('./project.ts');
      const p = await mod.ensureProject(tmpDir);
      // marker file exists
      expect(fs.existsSync(p.markerPath)).toBe(true);
      // codewalker dir + subdirs are created
      expect(fs.existsSync(p.codewalkerDir)).toBe(true);
      expect(fs.existsSync(p.entriesDir)).toBe(true);
      expect(fs.existsSync(p.symbolsDir)).toBe(true);
      expect(fs.existsSync(p.libsDir)).toBe(true);
      expect(fs.existsSync(p.glossaryDir)).toBe(true);
      expect(fs.existsSync(p.decisionsDir)).toBe(true);
      expect(fs.existsSync(p.analysisDir)).toBe(true);
      expect(fs.existsSync(p.conventionsDir)).toBe(true);
      // meta.json written
      expect(fs.existsSync(p.metaFile)).toBe(true);
      // meta.json has correct shape
      const meta = JSON.parse(fs.readFileSync(p.metaFile, 'utf-8'));
      expect(meta.id).toBe(p.id);
      expect(meta.name).toBe(path.basename(tmpDir));
      expect(Array.isArray(meta.paths)).toBe(true);
      expect(meta.paths).toContain(tmpDir);
    });

    it('is idempotent — calling ensureProject twice does not error', async () => {
      const mod = await import('./project.ts');
      await mod.ensureProject(tmpDir);
      await mod.ensureProject(tmpDir);
      // No error means idempotent
      const p = mod.resolveProject(tmpDir);
      expect(fs.existsSync(p.codewalkerDir)).toBe(true);
    });
  });
});
