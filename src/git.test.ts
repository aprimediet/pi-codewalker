import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { getHeadSha, changedFilesSince, parseDiffNameOnly } from './git.ts';

describe('parseDiffNameOnly', () => {
  it('parses git diff --name-only output into string[]', () => {
    const output = `src/a.ts\nsrc/b.ts\nREADME.md\n`;
    const files = parseDiffNameOnly(output);
    expect(files).toEqual(['src/a.ts', 'src/b.ts', 'README.md']);
  });

  it('returns empty array for empty output', () => {
    expect(parseDiffNameOnly('')).toEqual([]);
  });

  it('trims whitespace from each line', () => {
    const output = `  src/a.ts \n  src/b.ts\n`;
    const files = parseDiffNameOnly(output);
    expect(files).toEqual(['src/a.ts', 'src/b.ts']);
  });
});

describe('git operations in a real repo', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-git-'));
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git config user.email test@test.com', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git config user.name Test', { cwd: tmpDir, stdio: 'ignore' });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('getHeadSha returns the current HEAD commit hash', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'content');
    execSync('git add . && git commit -m "first"', { cwd: tmpDir, stdio: 'ignore' });
    const sha = getHeadSha(tmpDir);
    expect(sha).toBeTruthy();
    expect(sha!.length).toBe(40);
  });

  it('getHeadSha returns null when there are no commits', () => {
    const sha = getHeadSha(tmpDir);
    expect(sha).toBeNull();
  });

  it('changedFilesSince returns [] when lastCommit === HEAD', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'content');
    execSync('git add . && git commit -m "first"', { cwd: tmpDir, stdio: 'ignore' });
    const sha = getHeadSha(tmpDir)!;
    const files = changedFilesSince(tmpDir, sha);
    expect(files).toEqual([]);
  });

  it('changedFilesSince returns changed files since a previous commit', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'v1');
    execSync('git add . && git commit -m "first"', { cwd: tmpDir, stdio: 'ignore' });
    const firstSha = getHeadSha(tmpDir)!;

    // Second commit
    fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'v2');
    fs.writeFileSync(path.join(tmpDir, 'b.ts'), 'new');
    execSync('git add . && git commit -m "second"', { cwd: tmpDir, stdio: 'ignore' });

    const files = changedFilesSince(tmpDir, firstSha);
    expect(files).toContain('a.ts');
    expect(files).toContain('b.ts');
  });
});
