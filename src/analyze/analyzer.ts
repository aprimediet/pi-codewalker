/**
 * Analysis orchestrator for codewalker v1.4.
 *
 * Coordinates:
 * - Coverage parsing (lcov.info / coverage-final.json)
 * - Debt scanning (TODO/FIXME/HACK/XXX, @ts-ignore, oversized files, long functions)
 * - Card writing (atomic, under entries/analysis/<kind>/)
 * - DB upsert (idempotent, per-file delete-then-insert)
 *
 * The agent-driven best-practice review (/codewalker review) is a separate path
 * that uses the `review.ts` helpers and the `codewalker_finding` tool.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { openDb, upsertFinding, deleteFindingsForFile, rebuildFtsIndexes, searchFindings } from "../db.ts";
import { parseLcov, parseCoverageJson, coverageSeverity } from "./coverage.ts";
import { scanDebt, summarizeDebt } from "./debt.ts";
import { renderAnalysisCard, parseAnalysisCard } from "./cards.ts";
import type { Finding, FindingKind } from "../types.ts";

export interface AnalyzeOptions {
  /** Project root directory (source files live here). */
  projectRoot: string;
  /** Directory where analysis/* cards are written (entries/analysis). */
  analysisDir: string;
  /** Path to the SQLite DB. */
  dbPath: string;
  /** Optional path filter — only analyze files under this path. */
  pathFilter?: string;
}

/** Supported file extensions for debt scanning. */
const SUPPORTED_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go",
]);

/**
 * Run mechanical analysis (coverage + debt) on a project.
 *
 * 1. Parse coverage/lcov.info or coverage/coverage-final.json if present.
 * 2. Walk source files and scan for debt markers/heuristics.
 * 3. Write finding cards under entries/analysis/<kind>/.
 * 4. Upsert findings to the DB (idempotent per file).
 */
export function runAnalyze(options: AnalyzeOptions): { coverage: number; debt: number } {
  const { projectRoot, analysisDir, dbPath, pathFilter } = options;

  // Ensure analysis dirs exist
  fs.mkdirSync(path.join(analysisDir, "coverage"), { recursive: true });
  fs.mkdirSync(path.join(analysisDir, "debt"), { recursive: true });

  const db = openDb(dbPath);
  rebuildFtsIndexes(db);

  const results = { coverage: 0, debt: 0 };

  try {
    // ── 1. Coverage parsing ─────────────────────────────────
    const coverageDir = path.join(projectRoot, "coverage");
    let coverageFiles: Finding[] = [];

    if (fs.existsSync(coverageDir)) {
      const lcovPath = path.join(coverageDir, "lcov.info");
      const jsonPath = path.join(coverageDir, "coverage-final.json");

      if (fs.existsSync(lcovPath)) {
        const lcovText = fs.readFileSync(lcovPath, "utf-8");
        const parsed = parseLcov(lcovText);
        coverageFiles = parsed.map((f) => ({
          finding_kind: "coverage" as FindingKind,
          title: `Low coverage: ${f.file}`,
          severity: coverageSeverity(f.pct),
          file_path: f.file,
          line_start: 0,
          line_end: 0,
          metric: `${f.pct}% (${f.lines_covered}/${f.lines_total} lines)`,
          body: `File "${f.file}" has ${f.pct}% line coverage (${f.lines_covered}/${f.lines_total} lines covered).${
            f.pct < 80 ? " Consider adding tests for uncovered paths." : ""
          }`,
          related: "",
        }));
      } else if (fs.existsSync(jsonPath)) {
        const jsonText = fs.readFileSync(jsonPath, "utf-8");
        const parsed = parseCoverageJson(JSON.parse(jsonText));
        coverageFiles = parsed.map((f) => ({
          finding_kind: "coverage" as FindingKind,
          title: `Low coverage: ${f.file}`,
          severity: coverageSeverity(f.pct),
          file_path: f.file,
          line_start: 0,
          line_end: 0,
          metric: `${f.pct}% (${f.lines_covered}/${f.lines_total} stmts)`,
          body: `File "${f.file}" has ${f.pct}% statement coverage (${f.lines_covered}/${f.lines_total} statements covered).${
            f.pct < 80 ? " Consider adding tests for uncovered paths." : ""
          }`,
          related: "",
        }));
      }

      // Write coverage cards + upsert
      for (const finding of coverageFiles) {
        writeFindingCard(finding, analysisDir);
        // Delete prior coverage findings for this file, then insert fresh
        deleteFindingsForFile(db, "coverage", finding.file_path ?? "");
        upsertFinding(db, {
          ...finding,
          severity: finding.severity,
        });
      }
    }

    results.coverage = coverageFiles.length;

    // ── 2. Debt scanning ────────────────────────────────────
    const sourceFiles = collectSourceFiles(projectRoot, pathFilter);
    const existingSymbols = db.prepare(
      "SELECT name, kind, file_path, line_start, line_end FROM symbols ORDER BY file_path, line_start",
    ).all() as Array<{ name: string; kind: string; file_path: string; line_start: number; line_end: number }>;

    for (const filePath of sourceFiles) {
      const ext = path.extname(filePath).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

      const content = fs.readFileSync(filePath, "utf-8");
      const fileSymbols = existingSymbols.filter(s => s.file_path === filePath);

      const rawFindings = scanDebt(filePath, content, fileSymbols);
      if (rawFindings.length === 0) continue;

      // Delete prior debt findings for this file
      deleteFindingsForFile(db, "debt", filePath);

      // Summarize (group by marker type) and write
      const summarized = summarizeDebt(rawFindings);
      for (const finding of summarized) {
        const dbFinding: Finding = {
          finding_kind: "debt",
          title: finding.title,
          severity: finding.severity,
          file_path: finding.file_path,
          line_start: finding.line_start,
          line_end: finding.line_end,
          metric: finding.metric,
          body: finding.body,
          related: "",
        };

        writeFindingCard(dbFinding, analysisDir);
        upsertFinding(db, dbFinding);
      }

      results.debt += summarized.length;
    }
  } finally {
    db.close();
  }

  return results;
}

/**
 * Rebuild the analysis DB tables from card files alone.
 * Demonstrates the disposable-index property: cards are the source of truth.
 */
export function rebuildAnalysisDbFromCards(
  dbPath: string,
  analysisDir: string,
): void {
  const db = openDb(dbPath);
  rebuildFtsIndexes(db);

  try {
    db.exec("BEGIN TRANSACTION");

    // Clear existing analysis
    db.prepare("DELETE FROM analysis").run();

    // Walk analysis subdirectories (coverage/, debt/, practice/)
    if (fs.existsSync(analysisDir)) {
      for (const kindDir of fs.readdirSync(analysisDir, { withFileTypes: true })) {
        if (!kindDir.isDirectory()) continue;
        const kind = kindDir.name;
        const kindPath = path.join(analysisDir, kind);
        processAnalysisCardsInDir(db, kindPath, kind);
      }
    }

    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  } finally {
    db.close();
  }
}

// ── Internal helpers ──────────────────────────────────────────

/** Walk analysis card files in a subdirectory and upsert them to the DB. */
function processAnalysisCardsInDir(
  db: ReturnType<typeof openDb>,
  dir: string,
  expectedKind: string,
): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const cardPath = path.join(dir, entry.name);
    const cardText = fs.readFileSync(cardPath, "utf-8");
    const parsed = parseAnalysisCard(cardText);
    if (!parsed) continue;
    if (parsed.finding_kind !== expectedKind) continue;

    // Parse location into file_path and line_start
    let filePath = parsed.location;
    let lineStart = 0;
    const locMatch = parsed.location.match(/^(.+):(\d+)$/);
    if (locMatch) {
      filePath = locMatch[1] ?? parsed.location;
      lineStart = parseInt(locMatch[2] ?? "0", 10);
    }

    upsertFinding(db, {
      finding_kind: parsed.finding_kind as FindingKind,
      title: parsed.title,
      severity: parsed.severity || undefined,
      file_path: filePath,
      line_start: lineStart,
      line_end: 0,
      metric: parsed.metric || undefined,
      body: parsed.summary || undefined,
      related: "",
      card_path: cardPath,
    });
  }
}

/** Write an analysis finding card to disk (atomic write). */
function writeFindingCard(finding: Finding, analysisDir: string): string {
  const kindDir = path.join(analysisDir, finding.finding_kind);
  if (!fs.existsSync(kindDir)) {
    fs.mkdirSync(kindDir, { recursive: true });
  }

  // Generate slug from the card title
  const slug = finding.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "finding";

  const cardPath = path.join(kindDir, `${slug}.md`);
  const card = renderAnalysisCard(finding);

  // Atomic write
  const tmpPath = cardPath + ".tmp";
  fs.writeFileSync(tmpPath, card, { encoding: "utf-8", mode: 0o600 });
  fs.renameSync(tmpPath, cardPath);

  return cardPath;
}

/** Collect source files under a project root, optionally filtered by path prefix. */
function collectSourceFiles(rootDir: string, pathFilter?: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".pi" || entry.name.startsWith(".")) continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SUPPORTED_EXTENSIONS.has(ext)) {
          // Apply path filter if specified
          if (pathFilter && !fullPath.includes(pathFilter)) continue;
          files.push(fullPath);
        }
      }
    }
  };
  if (fs.existsSync(rootDir)) {
    walk(rootDir);
  }
  return files;
}

// Re-export for testing
export { collectSourceFiles };
