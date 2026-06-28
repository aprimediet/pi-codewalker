/**
 * Coverage data parser for codewalker v1.4.
 *
 * PURE module — no I/O. Parses lcov.info and coverage-final.json artifacts
 * that already exist on disk. Never runs a coverage tool.
 */

import type { FileCoverage } from "../types.ts";

/**
 * Parse an lcov.info string into per-file coverage data.
 * Supports SF:, DA:, LF:, LH: and end_of_record markers.
 */
export function parseLcov(text: string): FileCoverage[] {
  if (!text.trim()) return [];

  const results: FileCoverage[] = [];
  let current: Record<string, any> | null = null;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("SF:")) {
      // Start a new record
      current = { file: trimmed.slice(3).trim(), lines: [], lf: 0, lh: 0 };
    } else if (current) {
      if (trimmed.startsWith("DA:")) {
        const parts = trimmed.slice(3).split(",");
        const lineNo = parseInt(parts[0] ?? "0", 10);
        const hit = parseInt(parts[1] ?? "0", 10);
        if (!isNaN(lineNo)) {
          current.lines.push({ line: lineNo, hit });
        }
      } else if (trimmed.startsWith("LF:")) {
        current.lf = parseInt(trimmed.slice(3).trim(), 10);
      } else if (trimmed.startsWith("LH:")) {
        current.lh = parseInt(trimmed.slice(3).trim(), 10);
      } else if (trimmed === "end_of_record") {
        if (current.file) {
          const total = current.lf || current.lines.length;
          const covered = current.lh || current.lines.filter((l: any) => l.hit > 0).length;
          const pct = total > 0 ? (covered / total) * 100 : 100;
          results.push({
            file: current.file,
            lines_total: total,
            lines_covered: covered,
            pct: Math.round(pct * 10) / 10,
          });
        }
        current = null;
      }
    }
  }

  return results;
}

/**
 * Parse a coverage-final.json object (istanbul/nyc format) into per-file coverage data.
 */
export function parseCoverageJson(
  data: Record<string, any> | null | undefined,
): FileCoverage[] {
  if (!data || typeof data !== "object") return [];

  const results: FileCoverage[] = [];

  for (const [filePath, fileData] of Object.entries(data)) {
    if (!fileData || typeof fileData !== "object") continue;
    const s = (fileData as any).s;
    if (!s || typeof s !== "object") continue;

    const statements = Object.values(s) as number[];
    const total = statements.length;
    const covered = statements.filter((v) => v > 0).length;
    const pct = total > 0 ? (covered / total) * 100 : 100;

    results.push({
      file: filePath,
      lines_total: total,
      lines_covered: covered,
      pct: Math.round(pct * 10) / 10,
    });
  }

  return results;
}

/**
 * Map a coverage percentage to a severity level.
 * <50% → high, 50-80% → warn, >=80% → info.
 */
export function coverageSeverity(pct: number): "info" | "warn" | "high" {
  if (pct < 50) return "high";
  if (pct < 80) return "warn";
  return "info";
}
