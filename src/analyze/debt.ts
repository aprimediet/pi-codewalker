/**
 * Technical debt scanner for codewalker v1.4.
 *
 * PURE module — no I/O. Scans source file content for:
 * - TODO/FIXME/HACK/XXX markers
 * - @ts-ignore / @ts-nocheck usage
 * - Oversized files (>400 lines)
 * - Long functions (>120 lines, derived from existing symbol rows)
 */

/** Default threshold for oversized file warning (lines). */
export const LARGE_FILE_LINES = 400;

/** Default threshold for long function warning (lines). */
export const LONG_FN_LINES = 120;

/** A single debt finding. */
export interface DebtFinding {
  title: string;
  file_path: string;
  line_start: number;
  line_end: number;
  marker: string;
  severity: "info" | "warn" | "high";
  metric: string;
  body: string;
}

/** A symbol row passed for function-length analysis. */
interface SymbolSpan {
  name: string;
  kind: string;
  file_path: string;
  line_start: number;
  line_end: number;
}

// Word-boundary regex for each marker type.
const MARKER_RE = /\b(TODO|FIXME|HACK|XXX)\b(?:\s*[:-]?\s*(.*))?/g;
const TS_IGNORE_RE = /\/\/\s*@ts-ignore\b/g;
const TS_NOCHECK_RE = /\/\/\s*@ts-nocheck\b/g;

/**
 * Scan a file's content for debt markers and heuristics.
 *
 * @param filePath - Absolute or relative file path (for the finding).
 * @param content - The full file content string.
 * @param symbols - Existing symbol rows for this file (for function-length analysis).
 * @returns An array of debt findings.
 */
export function scanDebt(
  filePath: string,
  content: string,
  symbols: SymbolSpan[],
): DebtFinding[] {
  const findings: DebtFinding[] = [];
  const lines = content ? content.split("\n") : [];

  // --- Scan markers in content ---
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    // TODO/FIXME/HACK/XXX
    MARKER_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MARKER_RE.exec(line)) !== null) {
      const marker = m[1]!;
      const detail = (m[2] ?? "").trim();
      const severity = marker === "FIXME" || marker === "HACK" ? "warn" : "info";
      findings.push({
        title: `${marker}: ${detail || line.trim().slice(0, 50)}`,
        file_path: filePath,
        line_start: i + 1,
        line_end: i + 1,
        marker,
        severity,
        metric: marker,
        body: line.trim(),
      });
    }

    // @ts-ignore
    TS_IGNORE_RE.lastIndex = 0;
    if (TS_IGNORE_RE.test(line)) {
      findings.push({
        title: `@ts-ignore at line ${i + 1}`,
        file_path: filePath,
        line_start: i + 1,
        line_end: i + 1,
        marker: "@ts-ignore",
        severity: "warn",
        metric: "@ts-ignore",
        body: line.trim(),
      });
    }

    // @ts-nocheck
    TS_NOCHECK_RE.lastIndex = 0;
    if (TS_NOCHECK_RE.test(line)) {
      findings.push({
        title: `@ts-nocheck in ${filePath}`,
        file_path: filePath,
        line_start: i + 1,
        line_end: i + 1,
        marker: "@ts-nocheck",
        severity: "high",
        metric: "@ts-nocheck",
        body: line.trim(),
      });
    }
  }

  // --- Oversized file heuristic ---
  if (lines.length > LARGE_FILE_LINES) {
    findings.push({
      title: `Oversized file: ${lines.length} lines`,
      file_path: filePath,
      line_start: 0,
      line_end: lines.length,
      marker: "oversized-file",
      severity: "warn",
      metric: `${lines.length} lines`,
      body: `File has ${lines.length} lines, exceeding the ${LARGE_FILE_LINES}-line threshold. Consider splitting into smaller modules.`,
    });
  }

  // --- Long function heuristic (from existing symbols) ---
  for (const sym of symbols) {
    if (sym.file_path !== filePath) continue;
    const fnLength = sym.line_end - sym.line_start;
    if (fnLength > LONG_FN_LINES) {
      findings.push({
        title: `Long function: ${sym.name} (${fnLength} lines)`,
        file_path: filePath,
        line_start: sym.line_start,
        line_end: sym.line_end,
        marker: "long-function",
        severity: "warn",
        metric: `fn length ${fnLength}`,
        body: `Function "${sym.name}" spans ${fnLength} lines (limit: ${LONG_FN_LINES}). Consider refactoring.`,
      });
    }
  }

  return findings;
}

/**
 * Group and summarize debt findings for a file.
 * Returns at most one finding per marker type with aggregated counts.
 */
export function summarizeDebt(findings: DebtFinding[]): DebtFinding[] {
  if (findings.length === 0) return [];

  const groups = new Map<string, DebtFinding[]>();
  for (const f of findings) {
    const key = f.marker;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }

  const result: DebtFinding[] = [];
  for (const [, group] of groups) {
    const first = group[0]!;
    if (group.length === 1) {
      result.push(first);
    } else {
      result.push({
        ...first,
        title: `${first.marker}: ${group.length} occurrences`,
        metric: `${first.marker} x${group.length}`,
        body: group.map(f => `  line ${f.line_start}: ${f.body}`).join("\n"),
        line_start: group[0]!.line_start,
        line_end: group[group.length - 1]!.line_end,
      });
    }
  }

  return result;
}
