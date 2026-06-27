/**
 * Git operations for codewalker's git-anchored incremental sync.
 *
 * Provides getHeadSha, changedFilesSince (git diff --name-only), and
 * the pure parser parseDiffNameOnly.
 */

import { execSync } from "node:child_process";

/**
 * Get the current HEAD commit SHA for a repo.
 * Returns null if there are no commits yet.
 */
export function getHeadSha(repoDir: string): string | null {
  try {
    const sha = execSync("git rev-parse HEAD", {
      cwd: repoDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
    return sha || null;
  } catch {
    return null;
  }
}

/**
 * Get the list of files changed between two commits.
 * Uses `git diff --name-only <from> <to>`.
 * Returns an empty array if no files changed.
 */
export function changedFilesSince(
  repoDir: string,
  sinceCommit: string,
): string[] {
  try {
    const output = execSync(
      `git diff --name-only "${sinceCommit}" HEAD`,
      {
        cwd: repoDir,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      },
    );
    return parseDiffNameOnly(output);
  } catch {
    return [];
  }
}

/**
 * Pure: parse the output of `git diff --name-only` into a string array.
 * Each line is a file path; ignores empty lines.
 */
export function parseDiffNameOnly(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
