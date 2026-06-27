/**
 * Parse Universal Ctags JSON output into Symbol[].
 *
 * Universal Ctags emits one JSON object per line with `--output-format=json`.
 * Fields: _type, name, path, pattern, line, kind, signature.
 *
 * This module is PURE — no I/O, takes strings and returns objects.
 */

import type { Symbol, SymbolKind } from "../types.ts";

/** Raw ctags tag as parsed from a JSON line. */
export interface CtagsTag {
  name: string;
  path: string;
  line: number;
  kind: string;
  signature: string;
}

/**
 * Map a ctags `kind` string to our canonical SymbolKind.
 * Unknown kinds are returned as-is so callers can handle them or skip.
 */
export function mapCtagsKind(kind: string): string {
  const mapping: Record<string, string> = {
    function: "function",
    variable: "const",
    class: "class",
    member: "method",
    enum: "enum",
    typedef: "type",
    interface: "interface",
    namespace: "namespace",
    module: "module",
  };
  return mapping[kind] ?? kind;
}

/**
 * Parse a single ctags JSON line into a CtagsTag, or null if it's not a tag line.
 */
export function parseCtagsLine(line: string): CtagsTag | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }

  // Only process _type === "tag"
  if (parsed["_type"] !== "tag") return null;

  const name = parsed["name"];
  const path = parsed["path"];
  const lineNum = parsed["line"];
  const kind = parsed["kind"];
  const signature = parsed["signature"];

  if (typeof name !== "string" || typeof path !== "string") return null;
  if (typeof lineNum !== "number") return null;

  return {
    name,
    path,
    line: lineNum,
    kind: typeof kind === "string" ? kind : "unknown",
    signature: typeof signature === "string" ? signature : "",
  };
}

/**
 * Parse multi-line ctags JSON output, returning Symbol[] with absolute paths.
 *
 * @param output - The raw stdout from ctags (one JSON object per line).
 * @param projectRoot - Absolute path to the project root, used to resolve relative file paths.
 */
export function parseCtagsOutput(output: string, projectRoot: string): Symbol[] {
  if (!output.trim()) return [];

  const lines = output.split("\n");
  const symbols: Symbol[] = [];

  for (const line of lines) {
    const tag = parseCtagsLine(line);
    if (!tag) continue;

    // Resolve relative paths against project root
    const filePath = tag.path.startsWith("/")
      ? tag.path
      : `${projectRoot.replace(/\/+$/, "")}/${tag.path}`;

    symbols.push({
      name: tag.name,
      kind: mapCtagsKind(tag.kind) as SymbolKind,
      file_path: filePath,
      line_start: tag.line,
      line_end: tag.line, // ctags only gives start line
      signature: tag.signature,
      doc: "",
      summary: "",
      card_path: "",
    });
  }

  return symbols;
}


