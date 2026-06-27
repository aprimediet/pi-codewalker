/**
 * Core types for the codewalker code index.
 *
 * These types are shared across all layers (extraction, cards, DB, query).
 */

/** The kind of a code symbol. */
export type SymbolKind =
  | "function"
  | "const"
  | "class"
  | "type"
  | "method"
  | "enum"
  | "variable"
  | "interface"
  | "namespace"
  | "module";

/** A single symbol extracted from source code. */
export interface Symbol {
  name: string;
  kind: SymbolKind;
  file_path: string;
  line_start: number;
  line_end: number;
  signature: string;
  doc: string;
  summary: string; // reserved for v1.3; empty in v1.1
  card_path: string;
}

/** The frontmatter head of a markdown card — what `query` returns (compact, token-cheap). */
export interface CardHead {
  name: string;
  kind: string;
  signature: string;
  location: string; // "file.ts:10-42"
  tags: string[];
  summary: string;
}

/** A single row returned from a query. */
export interface QueryResultRow {
  name: string;
  kind: string;
  file_path: string;
  line_start: number;
  line_end: number;
  signature: string;
  summary: string;
  score: number;
  id: number;
}

/** The full result of a query, including staleness info. */
export interface QueryResult {
  rows: QueryResultRow[];
  staleness: StalenessInfo | null;
}

/** Git-anchored staleness signal attached to every query result. */
export interface StalenessInfo {
  indexedCommit: string;
  headCommit: string;
  changedFiles: number;
  message: string;
}

/** Metadata about the index stored in meta.json. */
export interface IndexMeta {
  schemaVersion: number;
  lastIndexedCommit: string;
  lastFullScan: string; // ISO date
}

/** Configuration for the codebase indexer. */
export interface IndexerConfig {
  language: "ts" | "js" | "py" | "go" | "rs";
  extensions: string[];
}

/** Map of language → file extension list. */
export const SUPPORTED_LANGUAGES: Record<string, string[]> = {
  ts: [".ts", ".tsx"],
  js: [".js", ".jsx", ".mjs", ".cjs"],
  py: [".py"],
  go: [".go"],
};
