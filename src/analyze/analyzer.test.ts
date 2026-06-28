import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { runAnalyze, rebuildAnalysisDbFromCards } from './analyzer.ts';
import { openDb, searchFindings } from '../db.ts';

describe('analyzer.ts', () => {
  let tmpDir: string;
  let projectRoot: string;
  let analysisDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-analyze-'));
    projectRoot = path.join(tmpDir, 'project');
    analysisDir = path.join(tmpDir, 'codewalker', 'entries', 'analysis');
    const dbDir = path.join(tmpDir, 'codewalker');
    dbPath = path.join(dbDir, 'index.db');
    fs.mkdirSync(analysisDir, { recursive: true });
    fs.mkdirSync(dbDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runAnalyze with no coverage file still produces debt findings from source scan', () => {
    // Create a source file with debt markers
    const srcDir = path.join(projectRoot, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(
      path.join(srcDir, 'a.ts'),
      '// normal line\nconst x = 1;\n// TODO: fix this\nfunction y() { return x; }\n',
      'utf-8'
    );

    runAnalyze({
      projectRoot,
      analysisDir,
      dbPath,
    });

    // Should have debt findings
    const db = openDb(dbPath);
    const findings = searchFindings(db, '');
    expect(findings.length).toBeGreaterThan(0);

    // At least one should be a debt finding
    const debtFindings = findings.filter(f => f.finding_kind === 'debt');
    expect(debtFindings.length).toBeGreaterThan(0);

    // Cards should be written
    const debtDir = path.join(analysisDir, 'debt');
    expect(fs.existsSync(debtDir)).toBe(true);
    const cardFiles = fs.readdirSync(debtDir).filter(f => f.endsWith('.md'));
    expect(cardFiles.length).toBeGreaterThan(0);

    db.close();
  });

  it('runAnalyze parses coverage/lcov.info if present', () => {
    const srcDir = path.join(projectRoot, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'token.ts'), 'line1\nline2\nline3\n', 'utf-8');

    // Write coverage file
    const coverageDir = path.join(projectRoot, 'coverage');
    fs.mkdirSync(coverageDir, { recursive: true });
    fs.writeFileSync(
      path.join(coverageDir, 'lcov.info'),
      'SF:src/token.ts\nDA:1,1\nDA:2,0\nDA:3,1\nLF:3\nLH:2\nend_of_record\n',
      'utf-8'
    );

    runAnalyze({
      projectRoot,
      analysisDir,
      dbPath,
    });

    // Should have coverage findings
    const db = openDb(dbPath);
    const findings = searchFindings(db, '');
    const coverageFindings = findings.filter(f => f.finding_kind === 'coverage');
    expect(coverageFindings.length).toBeGreaterThan(0);

    // Card files should be written
    const coverageDir2 = path.join(analysisDir, 'coverage');
    expect(fs.existsSync(coverageDir2)).toBe(true);

    db.close();
  });

  it('runAnalyze parses coverage/coverage-final.json if lcov.info is absent', () => {
    const srcDir = path.join(projectRoot, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'token.ts'), 'line1\nline2\n', 'utf-8');

    // Write coverage-final.json
    const coverageDir = path.join(projectRoot, 'coverage');
    fs.mkdirSync(coverageDir, { recursive: true });
    fs.writeFileSync(
      path.join(coverageDir, 'coverage-final.json'),
      JSON.stringify({
        'src/token.ts': {
          path: 'src/token.ts',
          statementMap: { '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 5 } }, '1': { start: { line: 2, column: 0 }, end: { line: 2, column: 5 } } },
          fnMap: {}, branchMap: {},
          s: { '0': 1, '1': 0 },
          f: {}, b: {},
        },
      }),
      'utf-8'
    );

    runAnalyze({
      projectRoot,
      analysisDir,
      dbPath,
    });

    const db = openDb(dbPath);
    const findings = searchFindings(db, '');
    const coverageFindings = findings.filter(f => f.finding_kind === 'coverage');
    expect(coverageFindings.length).toBeGreaterThan(0);
    db.close();
  });

  it('re-running analyze on same project does not duplicate findings', () => {
    const srcDir = path.join(projectRoot, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'a.ts'), '// TODO: once\n', 'utf-8');

    runAnalyze({ projectRoot, analysisDir, dbPath });
    runAnalyze({ projectRoot, analysisDir, dbPath }); // second run

    const db = openDb(dbPath);
    const findings = searchFindings(db, '');
    // All findings should be unique — no duplicates per (finding_kind, file_path, title)
    const titles = findings.map(f => f.name);
    const uniqueTitles = new Set(titles);
    expect(titles.length).toBe(uniqueTitles.size);
    db.close();
  });

  it('rebuildAnalysisDbFromCards reconstructs the DB from card files alone', () => {
    // First run to create cards
    const srcDir = path.join(projectRoot, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'a.ts'), '// TODO: rebuild this\nconst x = 1;\n', 'utf-8');

    runAnalyze({ projectRoot, analysisDir, dbPath });

    // Verify there are cards on disk
    const debtDir = path.join(analysisDir, 'debt');
    const cardFiles = fs.existsSync(debtDir) ? fs.readdirSync(debtDir).filter(f => f.endsWith('.md')) : [];
    expect(cardFiles.length).toBeGreaterThan(0);

    // Destroy DB and rebuild
    const db = openDb(dbPath);
    db.prepare('DELETE FROM analysis').run();
    const beforeRebuild = searchFindings(db, '');
    expect(beforeRebuild).toHaveLength(0);
    db.close();

    // Rebuild from cards
    rebuildAnalysisDbFromCards(dbPath, analysisDir);

    // Verify findings are back
    const db2 = openDb(dbPath);
    const afterRebuild = searchFindings(db2, '');
    expect(afterRebuild.length).toBeGreaterThan(0);
    expect(afterRebuild[0]!.finding_kind).toBe('debt');
    db2.close();
  });

  it('runAnalyze reports when no coverage data is found without erroring', () => {
    // No coverage files, no source files
    const srcDir = path.join(projectRoot, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    // Should not throw
    expect(() => runAnalyze({ projectRoot, analysisDir, dbPath })).not.toThrow();

    // With no source files either, findings should be empty
    const db = openDb(dbPath);
    const findings = searchFindings(db, '');
    expect(findings).toHaveLength(0);
    db.close();
  });

  it('runAnalyze respects a custom path filter for debt scanning', () => {
    const srcDir = path.join(projectRoot, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'a.ts'), '// TODO: file a\n', 'utf-8');
    fs.writeFileSync(path.join(srcDir, 'b.ts'), '// TODO: file b\n', 'utf-8');

    runAnalyze({
      projectRoot,
      analysisDir,
      dbPath,
      pathFilter: 'src/a.ts',
    });

    const db = openDb(dbPath);
    const findings = searchFindings(db, '');
    const aFindings = findings.filter(f => f.file_path?.endsWith('a.ts'));
    const bFindings = findings.filter(f => f.file_path?.endsWith('b.ts'));
    expect(aFindings.length).toBeGreaterThan(0);
    expect(bFindings).toHaveLength(0);
    db.close();
  });
});
