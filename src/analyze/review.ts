/**
 * Review helpers for codewalker v1.4.
 *
 * Pure/lightweight helpers for the agent-driven best-practice review workflow:
 * - `validateReviewPath()` — ensures path is provided
 * - `checkReviewCap()` — enforces the review cap guardrail
 * - `selectFilesForReview()` — selects files under a path prefix with cap
 * - `formatReviewWorklist()` — formats worklist items for agent display
 *
 * Mirrors the shape of enrich.ts.
 */

/** Default maximum files per review command. */
export const DEFAULT_REVIEW_CAP = 25;

/** Result of validateReviewPath. */
export interface PathValidation {
  valid: boolean;
  error?: string;
}

/** Result of checkReviewCap. */
export interface CapCheck {
  ok: boolean;
  count: number;
  /** Number of files over the cap (only when !ok). */
  skipped: number;
  error?: string;
}

/**
 * Validate that a review path was provided.
 */
export function validateReviewPath(path: string | undefined | null): PathValidation {
  const trimmed = (path ?? "").trim();
  if (!trimmed) {
    return {
      valid: false,
      error: 'Specify a path, e.g. src/auth. Bare /codewalker review with no path is not allowed.',
    };
  }
  return { valid: true };
}

/**
 * Check whether a count of files exceeds the cap.
 * If ok is false, the caller should refuse and tell the user to narrow the path.
 *
 * @param count - Number of files found.
 * @param cap - Maximum allowed (default: DEFAULT_REVIEW_CAP = 25).
 */
export function checkReviewCap(count: number, cap: number = DEFAULT_REVIEW_CAP): CapCheck {
  if (count > cap) {
    const skipped = count - cap;
    return {
      ok: false,
      count,
      skipped,
      error: `Refusing to review ${count} files (cap ${cap}). ` +
        `Narrow your path or raise the cap with --max=${count}.`,
    };
  }
  return { ok: true, count, skipped: 0 };
}

/**
 * Select files under a path prefix, respecting the cap.
 * Files not matching the prefix are excluded.
 *
 * @param files - Full list of source file paths.
 * @param pathPrefix - The path prefix to filter by (empty string = all files).
 * @param cap - Maximum number to select.
 * @returns Array of file paths matching the prefix, up to cap.
 */
export function selectFilesForReview(
  files: string[],
  pathPrefix: string,
  cap: number,
): string[] {
  const matching = pathPrefix
    ? files.filter(f => f.startsWith(pathPrefix))
    : files;
  return matching.slice(0, cap);
}

/**
 * Format a review worklist for the agent to process.
 * Each line shows one file to review. Includes instructions about grounding
 * findings in the project's own conventions and decisions.
 */
export function formatReviewWorklist(
  files: string[],
  pathPrefix: string,
): string {
  if (files.length === 0) {
    return `No files found under "${pathPrefix}" to review.`;
  }

  const lines: string[] = [
    `Found ${files.length} file(s) under "${pathPrefix}" selected for review:`,
    "",
  ];

  for (const file of files) {
    lines.push(`  ${file}`);
  }

  lines.push(
    "",
    "Instructions:",
    `  For each file above, read its content and judge it against the project's`,
    `  conventions and decisions. Before starting, query for relevant context:`,
    `    codewalker_query source:'all' query:'conventions'`,
    `    codewalker_query source:'all' query:'decisions'`,
    "",
    `  For each issue found, call \`codewalker_finding\` with kind='practice',`,
    `  an appropriate severity, and a body grounded in a specific convention or`,
    `  decision. Avoid generic style nits — only flag what the project's own`,
    `  conventions would flag.`,
    "",
    `  Example: \`codewalker_finding { kind: "practice", title: "...",`,
    `    file: "src/auth/token.ts", severity: "warn",`,
    `    body: "Convention X says Y, but this code does Z." }\``,
  );

  return lines.join("\n");
}
