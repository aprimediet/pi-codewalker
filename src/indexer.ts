/**
 * Codebase indexer: full scan and git-anchored incremental sync.
 *
 * - `scan()`: full build — walks the project tree, extracts symbols, writes cards, populates DB.
 * - `sync()`: git-anchored incremental — reindexes only changed files.
 * - `rebuildDbFromCards()`: rebuilds the DB from markdown cards alone (disposable-index property).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { openDb, upsertSymbol, deleteFileSymbols, deleteFile, setMeta, getMeta } from "./db.ts";
import { detectCtags, runCtags, runCtagsOnFile } from "./extract/ctags.ts";
import { parseCtagsOutput } from "./extract/ctags-parse.ts";
import { extractRegex } from "./extract/regex.ts";
import { extractDocComment } from "./extract/docs.ts";
import { renderCard, parseCard } from "./cards.ts";
import { getHeadSha, changedFilesSince } from "./git.ts";
import type { Symbol } from "./types.ts";

export interface ScanOptions {
  projectRoot: string;
  globalCodewalkerDir: string;
  dbPath: string;
  entriesDir: string;
  symbolsDir: string;
  useCtags?: boolean;
}

// Supported file extensions for extraction
const SUPPORTED_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go",
]);

/**
 * Full scan: walk the project tree, extract symbols, write cards, populate DB.
 * Idempotent: re-running rebuilds everything from scratch.
 */
export async function scan(options: ScanOptions): Promise<void> {
  const { projectRoot, dbPath, entriesDir, symbolsDir, globalCodewalkerDir } = options;
  const useCtags = options.useCtags ?? detectCtags();

  // Ensure directories exist
  fs.mkdirSync(symbolsDir, { recursive: true });

  // Collect all source files
  const files = collectSourceFiles(projectRoot);

  // Extract symbols
  const allSymbols: Symbol[] = [];

  if (useCtags) {
    const ctagsSymbols = runCtagsWrapper(projectRoot, files);
    allSymbols.push(...ctagsSymbols);
  }

  // Regex fallback for files ctags might have missed or when ctags is absent
  const regexFiles = useCtags
    ? files.filter(f => !hasCtagsSupport(path.extname(f)))
    : files;

  for (const filePath of regexFiles) {
    const ext = path.extname(filePath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

    const source = fs.readFileSync(filePath, "utf-8");
    const symbols = extractRegex(source, filePath);
    allSymbols.push(...symbols);
  }

  // For all symbols, extract doc comments
  for (const sym of allSymbols) {
    try {
      const source = fs.readFileSync(sym.file_path, "utf-8");
      const doc = extractDocComment(source, sym.line_start);
      sym.doc = doc;
    } catch {
      // File might have been deleted between scan and read
    }
  }

  // Open DB
  const db = openDb(dbPath);

  try {
    // Start transaction
    db.exec("BEGIN TRANSACTION");

    // Clear existing data for this project's files
    // We track which files we're about to index
    const indexedPaths = new Set(allSymbols.map(s => s.file_path));

    // Remove existing entries for files that no longer exist
    const existingFiles = db.prepare("SELECT path FROM files").all() as { path: string }[];
    for (const f of existingFiles) {
      if (!indexedPaths.has(f.path)) {
        deleteFileSymbols(db, f.path);
        deleteFile(db, f.path);
      }
    }

    // For existing files, also clean and re-insert
    for (const sym of allSymbols) {
      deleteFileSymbols(db, sym.file_path);
    }

    // Write cards and insert symbols
    for (const sym of allSymbols) {
      // Generate card path
      const fileSlug = slugFromPath(sym.file_path);
      const cardFileName = `${sanitizeName(sym.name)}.md`;
      const cardDir = path.join(symbolsDir, fileSlug);
      fs.mkdirSync(cardDir, { recursive: true });
      const cardPath = path.join(cardDir, cardFileName);

      // Render and write card
      const card = renderCard(sym);
      const tmpPath = cardPath + ".tmp";
      fs.writeFileSync(tmpPath, card, { encoding: "utf-8", mode: 0o600 });
      fs.renameSync(tmpPath, cardPath);

      // Update sym with card_path and insert into DB
      sym.card_path = cardPath;
      upsertSymbol(db, sym);
    }

    // Update meta
    const headSha = getHeadSha(projectRoot) ?? "";
    setMeta(db, "last_indexed_commit", headSha);
    setMeta(db, "last_full_scan", new Date().toISOString());
    setMeta(db, "schema_version", "1");

    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  } finally {
    db.close();
  }
}

/**
 * Git-anchored incremental sync.
 * Reindexes only changed files since last_indexed_commit.
 */
export async function sync(options: ScanOptions): Promise<void> {
  const { projectRoot, dbPath, entriesDir, symbolsDir } = options;
  const useCtags = options.useCtags ?? detectCtags();

  const db = openDb(dbPath);

  try {
    const lastCommit = getMeta(db, "last_indexed_commit");
    let changedFiles: string[] = [];

    if (lastCommit) {
      changedFiles = changedFilesSince(projectRoot, lastCommit);
    }

    // Convert git's relative paths to absolute
    const changedAbs = changedFiles.map((f) => path.resolve(projectRoot, f));

    // Also scan for new files (git might not track untracked files)
    const allFiles = collectSourceFiles(projectRoot);
    const indexedFiles = new Set(
      (db.prepare("SELECT path FROM files").all() as { path: string[] }).map(r => r.path as string),
    );

    // Find new files not yet indexed
    const newFiles = allFiles.filter(f => !indexedFiles.has(f));

    // Combine changed + new (all absolute paths)
    const filesToProcess = new Set([...changedAbs, ...newFiles]);

    if (filesToProcess.size === 0) {
      // Nothing to do, but still update commit pointer
      const headSha = getHeadSha(projectRoot) ?? "";
      setMeta(db, "last_indexed_commit", headSha);
      db.close();
      return;
    }

    // Process changed files
    for (const fullPath of filesToProcess) {
      const ext = path.extname(fullPath).toLowerCase();

      if (!fs.existsSync(fullPath)) {
        // File was deleted — use absolute path for DB operations
        deleteFileSymbols(db, fullPath);
        deleteFile(db, fullPath);

        // Remove card directory
        const fileSlug = slugFromPath(fullPath);
        const cardDir = path.join(symbolsDir, fileSlug);
        if (fs.existsSync(cardDir)) {
          fs.rmSync(cardDir, { recursive: true, force: true });
        }
        continue;
      }

      if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

      // Re-extract
      const source = fs.readFileSync(fullPath, "utf-8");
      let symbols: Symbol[] = [];

      if (useCtags && hasCtagsSupport(ext)) {
        const ctagsOutput = runCtagsOnFile(fullPath, projectRoot);
        symbols = parseCtagsOutput(ctagsOutput, projectRoot);
      } else if (SUPPORTED_EXTENSIONS.has(ext)) {
        symbols = extractRegex(source, fullPath);
      }

      // Extract doc comments
      for (const sym of symbols) {
        sym.doc = extractDocComment(source, sym.line_start);
      }

      // Remove old entries — use the full absolute path
      deleteFileSymbols(db, fullPath);

      // Write cards and insert
      for (const sym of symbols) {
        const fileSlug = slugFromPath(sym.file_path);
        const cardFileName = `${sanitizeName(sym.name)}.md`;
        const cardDir = path.join(symbolsDir, fileSlug);
        fs.mkdirSync(cardDir, { recursive: true });
        const cardPath = path.join(cardDir, cardFileName);

        const card = renderCard(sym);
        const tmpPath = cardPath + ".tmp";
        fs.writeFileSync(tmpPath, card, { encoding: "utf-8", mode: 0o600 });
        fs.renameSync(tmpPath, cardPath);

        sym.card_path = cardPath;
        upsertSymbol(db, sym);
      }
    }

    // Update commit pointer
    const headSha = getHeadSha(projectRoot) ?? "";
    setMeta(db, "last_indexed_commit", headSha);

    db.close();
  } catch (e) {
    db.close();
    throw e;
  }
}

/**
 * Rebuild the SQLite DB from markdown cards alone.
 * This demonstrates the disposable-index property: cards are the source of truth.
 */
export function rebuildDbFromCards(
  dbPath: string,
  entriesDir: string,
): void {
  const symbolsDir = path.join(entriesDir, "symbols");
  if (!fs.existsSync(symbolsDir)) return;

  const db = openDb(dbPath);

  try {
    db.exec("BEGIN TRANSACTION");

    // Walk card files
    const walkDir = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          const card = fs.readFileSync(fullPath, "utf-8");
          const parsed = parseCard(card);
          if (!parsed) continue;

          const { head } = parsed;
          const locMatch = head.location.match(/^(.+):(\d+)-(\d+)$/);
          if (!locMatch) continue;

          upsertSymbol(db, {
            name: head.name,
            kind: head.kind,
            file_path: locMatch[1] ?? head.location,
            line_start: parseInt(locMatch[2] ?? "0", 10),
            line_end: parseInt(locMatch[3] ?? "0", 10),
            signature: head.signature,
            doc: parsed.body,
            summary: head.summary,
            card_path: fullPath,
          });
        }
      }
    };

    walkDir(symbolsDir);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  } finally {
    db.close();
  }
}

// ---- Internal helpers ----

function collectSourceFiles(rootDir: string): string[] {
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
          files.push(fullPath);
        }
      }
    }
  };
  walk(rootDir);
  return files;
}

function hasCtagsSupport(ext: string): boolean {
  return [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go"].includes(ext);
}

function runCtagsWrapper(projectRoot: string, files: string[]): Symbol[] {
  try {
    const output = runCtags(files, projectRoot);
    return parseCtagsOutput(output, projectRoot);
  } catch {
    return [];
  }
}

function slugFromPath(filePath: string): string {
  return filePath
    .replace(/^\/+/, "")
    .replace(/[^a-zA-Z0-9_\-/]/g, "_")
    .replace(/\//g, "-")
    .toLowerCase();
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_$]/g, "_");
}
