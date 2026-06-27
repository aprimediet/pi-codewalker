/**
 * Markdown card rendering and parsing for codewalker.
 *
 * A card has a frontmatter head (agent-cheap, compact) and a body (human-rich, verbose).
 * The head is what `query` returns; the full card is only expanded on demand.
 *
 * PURE module — no I/O.
 */

import type { Symbol, CardHead } from "./types.ts";
import * as path from "node:path";

/**
 * Render a Symbol into a markdown card string with frontmatter head + body.
 */
export function renderCard(symbol: Symbol): string {
  const location = `${path.basename(symbol.file_path)}:${symbol.line_start}-${symbol.line_end}`;
  const name = symbol.name;
  const summary = symbol.summary || symbol.doc.split("\n")[0]?.trim() || "";

  const frontmatter = [
    "---",
    `name: ${name}`,
    `kind: ${symbol.kind}`,
    `signature: ${symbol.signature || ""}`,
    `location: ${location}`,
    `summary: ${summary}`,
    "---",
  ].join("\n");

  const body = symbol.doc
    ? [`# ${name}`, "", symbol.doc].join("\n")
    : `# ${name}`;

  return `${frontmatter}\n\n${body}\n`;
}

/**
 * Parse a markdown card string into head + body.
 * Returns null if the card is invalid.
 */
export function parseCard(text: string): { head: CardHead; body: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("---")) return null;

  // Find the closing ---
  const endOfFm = trimmed.indexOf("\n---", 3);
  if (endOfFm === -1) return null;

  const fmRaw = trimmed.slice(3, endOfFm).trim();
  const body = trimmed.slice(endOfFm + 4).trim();

  // Parse frontmatter lines
  const fm: Record<string, string> = {};
  for (const line of fmRaw.split("\n")) {
    const sep = line.indexOf(":");
    if (sep > 0) {
      const key = line.slice(0, sep).trim();
      const value = line.slice(sep + 1).trim();
      fm[key] = value;
    }
  }

  if (!fm["name"]) return null;

  return {
    head: {
      name: fm["name"] ?? "",
      kind: fm["kind"] ?? "",
      signature: fm["signature"] ?? "",
      location: fm["location"] ?? "",
      tags: (fm["tags"] ?? "").split(",").map((t) => t.trim()).filter(Boolean),
      summary: fm["summary"] ?? "",
    },
    body,
  };
}

/**
 * Extract only the frontmatter head from a card — the compact, agent-cheap view.
 * Returns null if the card is invalid.
 */
export function cardHead(text: string): CardHead | null {
  const parsed = parseCard(text);
  if (!parsed) return null;
  return parsed.head;
}
