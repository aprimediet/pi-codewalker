/**
 * .d.ts symbol extraction — regex/line-based, PURE (no I/O).
 *
 * Extracts top-level exported declarations from a `.d.ts` source string.
 * Modeled on src/extract/regex.ts. Returns LibSymbol[] for a given library.
 *
 * Handles these export forms:
 *   export declare function|const|class|enum|namespace
 *   export function|const|class|interface|type|enum|namespace
 *   export abstract class
 *   export { a, b as c } from "..."   (reexport)
 *   export { a, b }                    (local reexport)
 *   export * from "..."                (star reexport → name: "*")
 *   export default …                   (name: "default")
 *
 * Non-exported declarations are ignored. Leading JSDoc is captured.
 */

import type { LibSymbol, SymbolKind } from "../types.ts";
import { extractDocComment } from "../extract/docs.ts";

/**
 * Extract top-level exported symbols from a .d.ts source string.
 *
 * @param source - Full .d.ts file content.
 * @param lib - Library name.
 * @param version - Installed version.
 * @returns Array of extracted LibSymbol objects.
 */
export function extractDtsSymbols(
  source: string,
  lib: string,
  version: string,
): LibSymbol[] {
  const lines = source.split("\n");
  const symbols: LibSymbol[] = [];
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] as string;
    const trimmed = rawLine.trim();

    // Track block comments
    if (inBlockComment) {
      if (trimmed.includes("*/")) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith("/*") || trimmed.startsWith("/**")) {
      if (!trimmed.includes("*/")) inBlockComment = true;
      continue;
    }
    if (trimmed.startsWith("//")) continue;
    if (!trimmed) continue;

    // ── Named exports: export [declare] [abstract] <kind> <name> ──
    const namedExport = tryExtractNamedExport(trimmed, lines, i, lib, version, source);
    if (namedExport) {
      symbols.push(namedExport);
      continue;
    }

    // ── export default … (name always "default") ──
    const defaultExport = tryExtractDefaultExport(trimmed, lines, i, lib, version, source);
    if (defaultExport) {
      symbols.push(defaultExport);
      continue;
    }

    // ── Re-exports: export { … } or export * from … ──
    const reExport = tryExtractReexport(trimmed, lines, i, lib, version, source);
    if (reExport) {
      symbols.push(...reExport);
      continue;
    }
  }

  return symbols;
}

/**
 * Try to extract a named export declaration (function, const, class, interface, type, enum, namespace).
 */
function tryExtractNamedExport(
  trimmed: string,
  lines: string[],
  i: number,
  lib: string,
  version: string,
  source: string,
): LibSymbol | null {
  // Order matters: more specific before less specific.
  // Each pattern: regex with named-kind capture, and a name capture group index.
  const patterns: Array<{ regex: RegExp; kind: SymbolKind; nameIdx: number }> = [
    // function: export [declare] [abstract] [async] function [<T>] name
    { regex: /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?function\s+(?:<[^>]+>\s+)?(\w+)/, kind: "function", nameIdx: 1 },
    // class: export [declare] [abstract] class name
    { regex: /^export\s+(?:declare\s+)?(?:abstract\s+)?class\s+(\w+)/, kind: "class", nameIdx: 1 },
    // interface: export interface name
    { regex: /^export\s+interface\s+(\w+)/, kind: "interface", nameIdx: 1 },
    // type: export type name [<...>] =
    { regex: /^export\s+type\s+(\w+)/, kind: "type", nameIdx: 1 },
    // enum: export [declare] enum name
    { regex: /^export\s+(?:declare\s+)?enum\s+(\w+)/, kind: "enum", nameIdx: 1 },
    // namespace: export [declare] namespace name
    { regex: /^export\s+(?:declare\s+)?namespace\s+(\w+)/, kind: "namespace", nameIdx: 1 },
    // const/let/var: export [declare] const name
    { regex: /^export\s+(?:declare\s+)?(?:const|let|var)\s+(\w+)/, kind: "const", nameIdx: 1 },
  ];

  for (const p of patterns) {
    const m = trimmed.match(p.regex);
    if (m?.[p.nameIdx]) {
      return makeSymbol(lines, i, p.kind, m[p.nameIdx]!, lib, version, source);
    }
  }

  return null;
}

/**
 * Try to extract `export default …`.
 * Name is always "default". Kind is determined by what follows:
 * function → "function", class → "class", object/expr → "const".
 */
function tryExtractDefaultExport(
  trimmed: string,
  lines: string[],
  i: number,
  lib: string,
  version: string,
  source: string,
): LibSymbol | null {
  if (!trimmed.startsWith("export default")) return null;

  let kind: SymbolKind = "const";

  if (/^export\s+default\s+(?:async\s+)?function\s/.test(trimmed)) {
    kind = "function";
  } else if (/^export\s+default\s+(?:abstract\s+)?class\s/.test(trimmed)) {
    kind = "class";
  } else if (/^export\s+default\s+interface\s/.test(trimmed)) {
    kind = "interface";
  }

  return makeSymbol(lines, i, kind, "default", lib, version, source);
}

/**
 * Try to extract re-export declarations:
 *   export { a, b as c } [from "..."]
 *   export * from "..."
 */
function tryExtractReexport(
  trimmed: string,
  lines: string[],
  i: number,
  lib: string,
  version: string,
  source: string,
): LibSymbol[] | null {
  // export { a, b as c } [from "..."]
  const braceReexport = trimmed.match(/^export\s+\{([^}]+)\}(?:\s+from\s+["'][^"']*["'])?\s*;?\s*$/);
  if (braceReexport) {
    const names = braceReexport[1]!.split(",").map(s => s.trim()).filter(Boolean);
    return names.map((entry) => {
      const aliasMatch = entry.match(/^(\w+)\s+as\s+(\w+)$/);
      const name = aliasMatch?.[2] ?? entry;
      return makeSymbol(lines, i, "reexport", name, lib, version, source);
    });
  }

  // export * from "..."
  if (/^export\s+\*\s+from\s+["'][^"']*["']\s*;?\s*$/.test(trimmed)) {
    return [makeSymbol(lines, i, "reexport", "*", lib, version, source)];
  }

  return null;
}

/**
 * Build a LibSymbol from a declaration line.
 * Signature is the declaration line with the body (from `{` onward) stripped.
 */
function makeSymbol(
  lines: string[],
  lineIndex: number,
  kind: SymbolKind,
  name: string,
  lib: string,
  version: string,
  source: string,
): LibSymbol {
  const rawLine = (lines[lineIndex] as string).trim();

  // Signature: first line, strip everything from the first `{` onward
  const sigStart = rawLine.indexOf("{");
  const signature = (sigStart >= 0 ? rawLine.slice(0, sigStart) : rawLine).trim();

  // Capture JSDoc
  const doc = extractDocComment(source, lineIndex + 1);
  const summary = (doc.split("\n")[0] || "").trim();

  return {
    lib,
    version,
    name,
    kind,
    signature,
    doc,
    summary,
    card_path: "",
  };
}
