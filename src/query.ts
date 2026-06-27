/**
 * Query orchestration: wraps DB search with staleness detection.
 */

import type { QueryResult, QueryResultRow, StalenessInfo } from "./types.ts";
import { openDb, searchSymbols, getMeta } from "./db.ts";
import { getHeadSha, changedFilesSince } from "./git.ts";

export interface QueryParams {
  query: string;
  kind?: string;
  limit?: number;
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
    const rows = searchSymbols(
      db,
      params.query,
      params.kind,
      params.limit ?? 10,
    );

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
