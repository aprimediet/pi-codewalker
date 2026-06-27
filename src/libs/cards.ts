/**
 * Lib symbol card rendering for codewalker v1.2.
 *
 * PURE module — no I/O. Renders a LibSymbol into a markdown card
 * with frontmatter head (includes lib and version) and JSDoc body.
 */

import type { LibSymbol } from "../types.ts";
import * as path from "node:path";

/**
 * Render a LibSymbol into a markdown card string.
 *
 * Frontmatter head includes v1.1 fields PLUS lib/version:
 * ---
 * name: createMiddleware
 * kind: function
 * lib: hono
 * version: 4.6.3
 * signature: export declare function ...
 * location: hono/dist/helper.d.ts  (dts_path if available)
 * summary: ...
 * ---
 */
export function renderLibCard(sym: LibSymbol): string {
  const lines: string[] = ["---"];

  addHeadField(lines, "name", sym.name);
  addHeadField(lines, "kind", sym.kind);
  addHeadField(lines, "lib", sym.lib);
  addHeadField(lines, "version", sym.version);
  if (sym.signature) addHeadField(lines, "signature", sym.signature);
  if (sym.summary) addHeadField(lines, "summary", sym.summary);

  lines.push("---");
  lines.push("");

  // Body
  lines.push(`# ${sym.name}`);
  lines.push("");

  if (sym.doc) {
    lines.push(sym.doc);
  }

  return lines.join("\n") + "\n";
}

function addHeadField(lines: string[], key: string, value: string): void {
  // Ensure value doesn't break frontmatter
  const safe = value.replace(/\n/g, " ").trim();
  lines.push(`${key}: ${safe}`);
}
