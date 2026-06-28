/**
 * Query orchestration: wraps DB search with staleness detection.
 */

import type { QueryResult, QueryResultRow, StalenessInfo, NoteKind } from "./types.ts";
import { openDb, searchSymbols, searchLibSymbols, searchNotes, getMeta } from "./db.ts";
import { getHeadSha, changedFilesSince } from "./git.ts";

export interface QueryParams {
  query: string;
  kind?: string;
  limit?: number;
  /** Source scope: "code" (default, only code symbols), "libs" (only lib symbols), "notes" (only notes), or "all" (all three). */
  source?: "code" | "libs" | "notes" | "all";
}

/**
 * Run a query against a codewalker DB.
 *
 * @param dbPath - Path to the SQLite DB file.
 * @param params - Query parameters.
 * @param repoDir - Optional repo directory for staleness detection.
 */
export function runQuery(
  dbPath: string,
  params: QueryParams,
  repoDir?: string,
): QueryResult {
  const db = openDb(dbPath);

  try {
    const source = params.source ?? "code";
    const limit = params.limit ?? 10;

    let rows: QueryResultRow[];

    if (source === "libs") {
      rows = searchLibSymbols(db, params.query, params.kind, limit) as unknown as QueryResultRow[];
    } else if (source === "notes") {
      const noteRows = searchNotes(db, params.query, params.kind as NoteKind | undefined, limit);
      rows = noteRows as unknown as QueryResultRow[];
    } else if (source === "all") {
      // Run code + lib + note searches, merge, sort by score, apply limit
      const codeRows = searchSymbols(db, params.query, params.kind, limit);
      const libRows = searchLibSymbols(db, params.query, params.kind, limit) as unknown as QueryResultRow[];
      const noteRows = searchNotes(db, params.query, params.kind as NoteKind | undefined, limit * 2) as unknown as QueryResultRow[];

      // Merge and sort by score ascending (lower bm25 = better match)
      const merged: QueryResultRow[] = [...codeRows, ...libRows, ...noteRows];
      merged.sort((a, b) => a.score - b.score);
      rows = merged.slice(0, limit);
    } else {
      // "code" — default, existing behavior
      rows = searchSymbols(db, params.query, params.kind, limit);
    }

    const staleness = detectStaleness(db, repoDir);

    return { rows, staleness };
  } finally {
    db.close();
  }
}

/**
 * Detect whether the index is stale compared to the current git HEAD.
 */
function detectStaleness(
  db: Database,
  repoDir?: string,
): StalenessInfo | null {
  if (!repoDir) return null;

  const indexedCommit = getMeta(db, "last_indexed_commit");
  if (!indexedCommit) return null;

  const headCommit = getHeadSha(repoDir);
  if (!headCommit) return null;

  if (indexedCommit === headCommit) return null;

  const changedFiles = changedFilesSince(repoDir, indexedCommit);

  return {
    indexedCommit,
    headCommit,
    changedFiles: changedFiles.length,
    message: `Index is stale (${changedFiles.length} file(s) changed since last index)`,
  };
}

// Re-export for test convenience
export { detectStaleness };
