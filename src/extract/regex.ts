/**
 * Regex-based fallback symbol extraction for TS/JS/Py/Go.
 *
 * Used when ctags is not available on PATH. PURE module — no I/O.
 *
 * This is best-effort: it uses line-oriented regex patterns and does a simple
 * comment/string skip that handles most common cases but is not an AST parser.
 */

import type { Symbol, SymbolKind } from "../types.ts";

/** Extract symbols from TypeScript/JavaScript source. */
export function extractTsJs(source: string, filePath: string): Symbol[] {
  const lines = source.split("\n");
  const symbols: Symbol[] = [];

  // Track multi-line comments
  let inBlockComment = false;

  // Patterns for TS/JS declarations
  const patterns: Array<{ regex: RegExp; kind: SymbolKind }> = [
    { regex: /^(?:export\s+)?(?:async\s+)?function\s+(?:<[^>]+>\s+)?(\w+)/, kind: "function" },
    { regex: /^(?:export\s+)?(?:async\s+)?function\s*\*?\s*(\w+)/, kind: "function" },
    { regex: /^(?:export\s+)?class\s+(\w+)/, kind: "class" },
    { regex: /^(?:export\s+)?interface\s+(\w+)/, kind: "interface" },
    { regex: /^(?:export\s+)?type\s+(\w+)\s*=/, kind: "type" },
    { regex: /^export\s+(?:const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=/, kind: "const" },
    { regex: /^export\s+(?:const|let|var)\s+(\w+)\s*(?::\s*[^;{]+)?;/, kind: "const" },
    { regex: /^(?:export\s+)?enum\s+(\w+)/, kind: "enum" },
    { regex: /^(?:export\s+)?abstract\s+class\s+(\w+)/, kind: "class" },
    { regex: /^(?:export\s+)?default\s+(?:async\s+)?function\s+(\w+)/, kind: "function" },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) continue;

    // Track block comments
    if (inBlockComment) {
      if (trimmed.includes("*/")) {
        inBlockComment = false;
      }
      continue;
    }
    if (trimmed.startsWith("/*") || trimmed.startsWith("/**")) {
      if (trimmed.includes("*/") && !trimmed.startsWith("*/")) {
        // Single-line block comment, skip
        continue;
      }
      if (!trimmed.includes("*/")) {
        inBlockComment = true;
      }
      continue;
    }

    // Skip single-line comments
    if (trimmed.startsWith("//") || trimmed.startsWith("#")) continue;

    // Apply patterns
    for (const { regex, kind } of patterns) {
      const match = trimmed.match(regex);
      if (match && match[1]) {
        symbols.push({
          name: match[1],
          kind,
          file_path: filePath,
          line_start: i + 1, // 1-based
          line_end: i + 1,
          signature: "",
          doc: "",
          summary: "",
          card_path: "",
        });
        break; // one symbol per line
      }
    }
  }

  return symbols;
}

/** Extract symbols from Python source. */
export function extractPython(source: string, filePath: string): Symbol[] {
  const lines = source.split("\n");
  const symbols: Symbol[] = [];

  const patterns: Array<{ regex: RegExp; kind: SymbolKind }> = [
    { regex: /^(?:async\s+)?def\s+(\w+)\s*\(/, kind: "function" },
    { regex: /^class\s+(\w+)/, kind: "class" },
  ];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = (lines[i] as string).trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    for (const { regex, kind } of patterns) {
      const match = trimmed.match(regex);
      if (match && match[1]) {
        symbols.push({
          name: match[1],
          kind,
          file_path: filePath,
          line_start: i + 1,
          line_end: i + 1,
          signature: "",
          doc: "",
          summary: "",
          card_path: "",
        });
        break;
      }
    }
  }

  return symbols;
}

/** Extract symbols from Go source. */
export function extractGo(source: string, filePath: string): Symbol[] {
  const lines = source.split("\n");
  const symbols: Symbol[] = [];

  const funcPattern = /^func\s+(?:\([^)]*\)\s+)?(\w+)\s*\(/;
  const methodPattern = /^func\s+\([^)]*\)\s+(\w+)\s*\(/;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = (lines[i] as string).trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*")) continue;

    // Check for method first (has receiver)
    const methodMatch = trimmed.match(methodPattern);
    if (methodMatch && methodMatch[1]) {
      symbols.push({
        name: methodMatch[1],
        kind: "method",
        file_path: filePath,
        line_start: i + 1,
        line_end: i + 1,
        signature: "",
        doc: "",
        summary: "",
        card_path: "",
      });
      continue;
    }

    // Then check for regular function
    const funcMatch = trimmed.match(funcPattern);
    if (funcMatch && funcMatch[1]) {
      symbols.push({
        name: funcMatch[1],
        kind: "function",
        file_path: filePath,
        line_start: i + 1,
        line_end: i + 1,
        signature: "",
        doc: "",
        summary: "",
        card_path: "",
      });
    }
  }

  return symbols;
}

/**
 * Dispatch to the correct language extractor based on file extension.
 * Returns an empty array for unsupported languages.
 */
export function extractRegex(source: string, filePath: string): Symbol[] {
  const ext = filePath.toLowerCase().split(".").pop() ?? "";

  switch (ext) {
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return extractTsJs(source, filePath);
    case "py":
      return extractPython(source, filePath);
    case "go":
      return extractGo(source, filePath);
    default:
      return [];
  }
}
