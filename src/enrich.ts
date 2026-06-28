/**
 * Enrichment core for codewalker v1.3.
 *
 * Pure/lightweight helpers for the enrichment workflow:
 * - `validateEnrichPath()` — ensures path is provided
 * - `checkEnrichCap()` — enforces the enrichment cap guardrail
 * - `formatEnrichWorklist()` — formats worklist items for agent display
 *
 * The heavy lifting (selecting unenriched symbols) lives in db.ts.
 * The write-back path (updating card + DB) is in cards.ts + db.ts.
 */

/** Default maximum symbols per enrich command. */
export const DEFAULT_ENRICH_CAP = 40;

/** A single unenriched symbol from the selection query. */
export interface UnenrichedSymbol {
  name: string;
  kind: string;
  file_path: string;
  line_start: number;
  line_end: number;
  card_path: string;
}

/** Result of validateEnrichPath. */
export interface PathValidation {
  valid: boolean;
  error?: string;
}

/** Result of checkEnrichCap. */
export interface CapCheck {
  ok: boolean;
  count: number;
  /** Number of symbols over the cap (only when !ok). */
  skipped: number;
  error?: string;
}

/**
 * Validate that an enrichment path was provided.
 */
export function validateEnrichPath(path: string | undefined | null): PathValidation {
  const trimmed = (path ?? "").trim();
  if (!trimmed) {
    return {
      valid: false,
      error: 'specify a path, e.g. src/auth. Bare /codewalker enrich with no path is not allowed.',
    };
  }
  return { valid: true };
}

/**
 * Check whether a count of unenriched symbols exceeds the cap.
 * If ok is false, the caller should refuse and tell the user to narrow the path.
 *
 * @param count - Number of unenriched symbols found.
 * @param cap - Maximum allowed (default: DEFAULT_ENRICH_CAP = 40).
 */
export function checkEnrichCap(count: number, cap: number = DEFAULT_ENRICH_CAP): CapCheck {
  if (count > cap) {
    const skipped = count - cap;
    return {
      ok: false,
      count,
      skipped,
      error: `Refusing to enrich ${count} symbols (cap ${cap}). ` +
        `Narrow your path or raise the cap with --max=${count}.`,
    };
  }
  return { ok: true, count, skipped: 0 };
}

/**
 * Format an enrichment worklist for the agent to process.
 * Each line shows one unenriched symbol. Includes a header with instructions.
 */
export function formatEnrichWorklist(
  symbols: UnenrichedSymbol[],
  pathPrefix: string,
): string {
  if (symbols.length === 0) {
    return `No unenriched symbols found under "${pathPrefix}". All symbols in this path already have summaries.`;
  }

  const lines: string[] = [
    `Found ${symbols.length} unenriched symbol(s) under "${pathPrefix}":`,
    "",
  ];

  for (const sym of symbols) {
    const loc = `${sym.file_path}:${sym.line_start}-${sym.line_end}`;
    lines.push(`  ${sym.name} · ${sym.kind} · ${loc} · card: ${sym.card_path}`);
  }

  lines.push(
    "",
    "Instructions:",
    `  For each symbol above, read the source span and call \`codewalker_enrich\``,
    "  with a ≤120 character plain-English summary of what the symbol does.",
    `  Example: \`codewalker_enrich { card: "${symbols[0]?.card_path ?? '<card_path>'}", summary: "..." }\``,
  );

  return lines.join("\n");
}
