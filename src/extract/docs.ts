/**
 * Extract leading doc comments from source code.
 *
 * Given a source file and the line number of a symbol, walk upward collecting
 * adjacent comment lines. PURE module — no I/O.
 */

/**
 * Extract the doc comment block immediately above a given line in source.
 * Returns the concatenated text of the comment(s), or "" if none.
 */
export function extractDocComment(source: string, symbolLine: number): string {
  if (symbolLine <= 1) return "";

  const lines = source.split("\n");
  const parts: string[] = [];

  // Walk upward from the line just above the symbol
  let i = symbolLine - 2; // 0-based
  if (i < 0) return "";

  while (i >= 0) {
    const rawLine = lines[i] as string;
    const trimmed = rawLine.trim();

    // Blank line stops collection
    if (!trimmed) break;

    // Line comment (//)
    if (trimmed.startsWith("//")) {
      parts.unshift(trimmed.replace(/^\/\/\s*/, ""));
      i--;
      continue;
    }

    // Block comment handling
    const isBlockOpen = trimmed.startsWith("/*") || trimmed.startsWith("/**");
    const isBlockClose = trimmed.endsWith("*/");

    // Block comment continuation line (starts with *)
    // These appear between /* and */, typically "* text" or "*"
    const isBlockContent = /^\*\s?/.test(trimmed) && !isBlockOpen && !isBlockClose;

    if (isBlockClose) {
      // Line contains `*/`
      const content = extractStarContent(trimmed);
      if (content) parts.unshift(content);
      if (isBlockOpen) {
        // Single line: /** ... */
        i--;
        continue;
      }
      // Multi-line: enter block content mode
      // Continue walking up
      i--;
      while (i >= 0) {
        const aboveTrimmed = (lines[i] as string).trim();
        if (!aboveTrimmed) break;
        if (aboveTrimmed.startsWith("//")) {
          // Line comment ends the block, insert it and stop
          parts.unshift(aboveTrimmed.replace(/^\/\/\s*/, ""));
          i--;
          continue;
        }
        if (aboveTrimmed.startsWith("/*") || aboveTrimmed.startsWith("/**")) {
          // Found the opening
          const openContent = extractStarContent(aboveTrimmed);
          if (openContent) parts.unshift(openContent);
          i--;
          break;
        }
        // Block content line: * text or *
        if (/^\*\s?/.test(aboveTrimmed)) {
          const c = aboveTrimmed.replace(/^\*\s?/, "").trim();
          if (c) parts.unshift(c);
          i--;
          continue;
        }
        // Not block content — stop
        break;
      }
      continue;
    }

    if (isBlockContent) {
      // Encountered a * continuation line without having seen */
      // This means the */ is below us (closer to the symbol)
      // Walk DOWN to find it, then walk back UP
      // Actually, simpler: just treat * lines as content and walk up
      const content = trimmed.replace(/^\*\s?/, "").trim();
      if (content) parts.unshift(content);
      i--;
      continue;
    }

    if (isBlockOpen) {
      // Found opening without a close marker — extract and continue
      const content = extractStarContent(trimmed);
      if (content) parts.unshift(content);
      i--;
      continue;
    }

    // Python docstring (""" or ''')
    if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
      const quote = trimmed.startsWith('"""') ? '"""' : "'''";

      // Single-line: """text"""
      if (trimmed.startsWith(quote) && trimmed.endsWith(quote) && trimmed.length > quote.length) {
        const inner = trimmed.slice(quote.length, -quote.length).trim();
        if (inner) parts.unshift(inner);
        i--;
        continue;
      }

      // Multi-line opening
      if (trimmed.startsWith(quote) && !trimmed.endsWith(quote)) {
        const afterQuote = trimmed.slice(quote.length).trim();
        if (afterQuote) parts.unshift(afterQuote);
        i--;
        // Walk up to find closing quote
        while (i >= 0) {
          const aboveTrimmed = (lines[i] as string).trim();
          if (aboveTrimmed.endsWith(quote)) {
            const beforeQuote = aboveTrimmed.slice(0, -quote.length).trim();
            if (beforeQuote) parts.unshift(beforeQuote);
            i--;
            break;
          }
          parts.unshift(aboveTrimmed);
          i--;
        }
        continue;
      }

      // Just """ on its own line (closing or opening a multi-line)
      if (trimmed === quote) {
        // This is the closing """ — walk up to find the opening
        i--;
        while (i >= 0) {
          const aboveTrimmed = (lines[i] as string).trim();
          if (aboveTrimmed.startsWith(quote)) {
            const afterQuote = aboveTrimmed.slice(quote.length).trim();
            if (afterQuote) parts.unshift(afterQuote);
            i--;
            break;
          }
          parts.unshift(aboveTrimmed);
          i--;
        }
        continue;
      }
    }

    // Not a comment — stop
    break;
  }

  return parts.join("\n").trim();
}

/** Extract visible content from a line inside a /* or /** block comment. */
function extractStarContent(line: string): string {
  return line
    .replace(/^\/\**\s*/, "") // strip /* or /**
    .replace(/\s*\*\/$/, "")  // strip */
    .replace(/^\*\s?/, "")    // strip leading *
    .trim();
}
