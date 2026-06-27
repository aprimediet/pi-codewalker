/**
 * Thin shell: detect ctags on PATH and run it.
 *
 * Separated from ctags-parse.ts (PURE parsing) so the I/O boundary is explicit.
 */

import { execSync } from "node:child_process";

/**
 * Detect whether ctags is available on PATH.
 */
export function detectCtags(): boolean {
  try {
    execSync("ctags --version", { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run ctags on a list of files and return raw JSON output.
 */
export function runCtags(files: string[], projectRoot: string): string {
  const fileList = files.join(" ");
  return execSync(
    `ctags --output-format=json --fields=+nKzS -f - ${fileList}`,
    {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
    },
  );
}

/**
 * Run ctags on a single file and return raw JSON output.
 */
export function runCtagsOnFile(filePath: string, projectRoot: string): string {
  return execSync(
    `ctags --output-format=json --fields=+nKzS -f - "${filePath}"`,
    {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10000,
    },
  );
}
