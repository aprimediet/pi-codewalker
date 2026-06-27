import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { scan, rebuildDbFromCards } from './indexer.ts';
import { openDb, getMeta, searchSymbols } from './db.ts';

describe('indexer.ts', () => {
  let tmpDir: string;
  let globalDir: string;
  let cardsDir: string;
  let symbolsDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-indexer-'));
    globalDir = path.join(tmpDir, '.pi-global', 'projects', 'test-project', 'codewalker');
    cardsDir = path.join(globalDir, 'entries');
    symbolsDir = path.join(cardsDir, 'symbols');
    dbPath = path.join(globalDir, 'index.db');
    fs.mkdirSync(symbolsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeFixture(name: string, content: string): string {
    const p = path.join(tmpDir, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, 'utf-8');
    return p;
  }

  it('scan indexes TS files using regex fallback when ctags is unavailable', async () => {
    // Write fixture files
    writeFixture('src/hello.ts', 'export function hello(name: string): string { return "hi"; }');
    writeFixture('src/math.ts', 'export const PI = 3.14;\nfunction internal() {}');

    await scan({
      projectRoot: tmpDir,
      globalCodewalkerDir: globalDir,
      dbPath,
      entriesDir: cardsDir,
      symbolsDir,
      useCtags: false, // force regex fallback
    });

    // Check DB was populated
    const db = openDb(dbPath);
    expect(getMeta(db, 'last_full_scan')).toBeTruthy();

    // Check symbols are findable
    const hello = searchSymbols(db, 'hello', undefined, 10);
    expect(hello.length).toBeGreaterThanOrEqual(1);
    expect(hello.some(s => s.name === 'hello')).toBe(true);

    // Check cards were written
    const cardFiles = fs.readdirSync(symbolsDir, { recursive: true }).filter(f => String(f).endsWith('.md'));
    expect(cardFiles.length).toBeGreaterThan(0);

    db.close();
  });

  it('scan is idempotent — running twice produces no duplicates', async () => {
    writeFixture('src/foo.ts', 'function foo() {}');

    await scan({
      projectRoot: tmpDir,
      globalCodewalkerDir: globalDir,
      dbPath,
      entriesDir: cardsDir,
      symbolsDir,
      useCtags: false,
    });

    await scan({
      projectRoot: tmpDir,
      globalCodewalkerDir: globalDir,
      dbPath,
      entriesDir: cardsDir,
      symbolsDir,
      useCtags: false,
    });

    const db = openDb(dbPath);
    const results = searchSymbols(db, '', undefined, 100);
    const fooCount = results.filter(s => s.name === 'foo').length;
    expect(fooCount).toBe(1);
    db.close();
  });

  it('rebuildDbFromCards reproduces the DB from cards alone', async () => {
    writeFixture('src/bar.ts', 'function bar() {}');

    await scan({
      projectRoot: tmpDir,
      globalCodewalkerDir: globalDir,
      dbPath,
      entriesDir: cardsDir,
      symbolsDir,
      useCtags: false,
    });

    // Delete the DB
    fs.rmSync(dbPath);
    if (fs.existsSync(dbPath + '-wal')) fs.rmSync(dbPath + '-wal');

    // Rebuild from cards
    rebuildDbFromCards(dbPath, cardsDir);

    // Check it works
    const db = openDb(dbPath);
    const bar = searchSymbols(db, 'bar', undefined, 10);
    expect(bar.length).toBeGreaterThanOrEqual(1);
    db.close();
  });

  it('scan with ctags absent still indexes TS/JS via regex', async () => {
    writeFixture('src/test.ts', 'type Result = string;\ninterface Props { x: number; }');
    writeFixture('src/util.js', 'function helper() { return 1; }');

    await scan({
      projectRoot: tmpDir,
      globalCodewalkerDir: globalDir,
      dbPath,
      entriesDir: cardsDir,
      symbolsDir,
      useCtags: false,
    });

    const db = openDb(dbPath);
    const all = searchSymbols(db, '', undefined, 100);
    expect(all.length).toBeGreaterThanOrEqual(3);
    db.close();
  });
});
