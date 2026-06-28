/**
 * Compact result formatter for codewalker queries.
 *
 * PURE module — no I/O. Produces token-bounded, one-line-per-hit output.
 */

import type { QueryResultRow, StalenessInfo } from "./types.ts";

const SUMMARY_MAX = 60;

/**
 * Format query results into compact, token-efficient output.
 *
 * Each row becomes one line: `name · kind · file:line · summary`
 * The total output is bounded by the number of rows.
 */
export function formatCompact(
  rows: QueryResultRow[],
  staleness: StalenessInfo | null,
): string {
  if (rows.length === 0) {
    let msg = "No matches found.";
    if (staleness) {
      msg += ` (${staleness.message})`;
    }
    return msg;
  }

  const lines = rows.map((row) => {
    if (row.source === "note" && row.note_kind) {
      const prefix = `[${row.note_kind}]`;
      const summary = truncate(row.summary || "", SUMMARY_MAX);
      return `${row.name} · ${row.note_kind} · ${prefix} · ${summary}`;
    }
    if (row.source === "lib" && row.lib && row.version) {
      const origin = `[${row.lib}@${row.version}]`;
      const summary = truncate(row.summary || "", SUMMARY_MAX);
      const loc = row.file_path ? `${basename(row.file_path)}:${row.line_start}-${row.line_end}` : `lib`;
      return `${row.name} · ${row.kind} · ${origin} · ${loc} · ${summary}`;
    }
    const loc = `${basename(row.file_path)}:${row.line_start}-${row.line_end}`;
    const summary = truncate(row.summary || "", SUMMARY_MAX);
    return `${row.name} · ${row.kind} · ${loc} · ${summary}`;
  });

  if (staleness) {
    lines.push(
      `---\n⚠ ${staleness.message}: indexed @${shortSha(staleness.indexedCommit)}, HEAD @${shortSha(staleness.headCommit)} (${staleness.changedFiles} file(s) changed)`,
    );
  }

  return lines.join("\n");
}

/**
 * Format a card body for display.
 */
export function formatCardBody(body: string): string {
  return body.trim();
}

function basename(filePath: string): string {
  const idx = filePath.lastIndexOf("/");
  return idx >= 0 ? filePath.slice(idx + 1) : filePath;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}
