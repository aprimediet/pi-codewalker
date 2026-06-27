import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { sync } from './indexer.ts';
import { openDb, getMeta, searchSymbols } from './db.ts';

describe('sync', () => {
  let tmpDir: string;
  let globalDir: string;
  let cardsDir: string;
  let symbolsDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-sync-'));
    globalDir = path.join(tmpDir, '.pi-global', 'projects', 'test-project', 'codewalker');
    cardsDir = path.join(globalDir, 'entries');
    symbolsDir = path.join(cardsDir, 'symbols');
    dbPath = path.join(globalDir, 'index.db');
    fs.mkdirSync(symbolsDir, { recursive: true });

    // Init git repo
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git config user.email test@test.com', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git config user.name Test', { cwd: tmpDir, stdio: 'ignore' });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeFile(name: string, content: string): void {
    const p = path.join(tmpDir, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, 'utf-8');
  }

  it('sync reindexes only changed files after an edit', async () => {
    writeFile('src/a.ts', 'function alpha() {}');
    writeFile('src/b.ts', 'function beta() {}');
    execSync('git add . && git commit -m "initial"', { cwd: tmpDir, stdio: 'ignore' });

    // First full scan
    await sync({
      projectRoot: tmpDir,
      globalCodewalkerDir: globalDir,
      dbPath,
      entriesDir: cardsDir,
      symbolsDir,
      useCtags: false,
    });

    const db = openDb(dbPath);
    expect(getMeta(db, 'last_indexed_commit')).toBeTruthy();
    const beforeEdit = searchSymbols(db, '', undefined, 100);
    const beforeCount = beforeEdit.length;
    db.close();

    // Edit one file
    writeFile('src/b.ts', 'function beta() {}\nfunction beta2() {}');
    execSync('git add . && git commit -m "edit b"', { cwd: tmpDir, stdio: 'ignore' });

    // Sync
    await sync({
      projectRoot: tmpDir,
      globalCodewalkerDir: globalDir,
      dbPath,
      entriesDir: cardsDir,
      symbolsDir,
      useCtags: false,
    });

    const db2 = openDb(dbPath);
    const afterEdit = searchSymbols(db2, '', undefined, 100);
    // Should have one more symbol (beta2 added)
    expect(afterEdit.length).toBe(beforeCount + 1);
    expect(afterEdit.some(s => s.name === 'beta2')).toBe(true);
    db2.close();
  });

  it('sync removes symbols for deleted files', async () => {
    writeFile('src/keep.ts', 'function keep() {}');
    writeFile('src/remove.ts', 'function removeMe() {}');
    execSync('git add . && git commit -m "initial"', { cwd: tmpDir, stdio: 'ignore' });

    await sync({
      projectRoot: tmpDir,
      globalCodewalkerDir: globalDir,
      dbPath,
      entriesDir: cardsDir,
      symbolsDir,
      useCtags: false,
    });

    // Delete one file
    fs.rmSync(path.join(tmpDir, 'src/remove.ts'));
    execSync('git add . && git commit -m "delete remove"', { cwd: tmpDir, stdio: 'ignore' });

    await sync({
      projectRoot: tmpDir,
      globalCodewalkerDir: globalDir,
      dbPath,
      entriesDir: cardsDir,
      symbolsDir,
      useCtags: false,
    });

    const db = openDb(dbPath);
    const all = searchSymbols(db, '', undefined, 100);
    expect(all.some(s => s.name === 'keep')).toBe(true);
    expect(all.some(s => s.name === 'removeMe')).toBe(false);
    db.close();
  });
});
