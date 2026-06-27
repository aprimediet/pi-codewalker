/**
 * Library indexer for codewalker v1.2.
 *
 * Orchestrates discovery → extraction → card writing → DB population
 * for third-party library dependencies installed in node_modules.
 *
 * - `indexLibraries()`: full pipeline — idempotent
 * - `rebuildLibDbFromCards()`: disposable-index rebuild
 *
 * Uses the same atomic write pattern (tmp + rename, 0o600) as the v1.1 indexer.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { openDb, upsertLibrary, upsertLibSymbol, deleteLibrary, setMeta } from "../db.ts";
import { locateLibrary } from "./resolve.ts";
import { extractDtsSymbols } from "./dts.ts";
import { renderLibCard } from "./cards.ts";
import { parseCard } from "../cards.ts";
import type { LibSymbol } from "../types.ts";

export interface IndexLibrariesOptions {
  projectRoot: string;
  libsDir: string;
  dbPath: string;
  includeDev?: boolean;
}

export interface IndexResult {
  indexed: number;  // library count indexed
  symbols: number;  // total symbols extracted
  errors: number;   // libraries that failed
}

/**
 * Full library index pipeline:
 * 1. Read project package.json → dependency names
 * 2. For each dep, locate installed package (version, .d.ts, README)
 * 3. Extract symbols from .d.ts
 * 4. Write cards under entries/libs/<pkg>@<version>/
 * 5. Populate libraries + lib_symbols tables
 *
 * Idempotent: version changes prune old data; re-running with no changes is stable.
 */
export async function indexLibraries(options: IndexLibrariesOptions): Promise<IndexResult> {
  const { projectRoot, libsDir, dbPath, includeDev } = options;

  // Read project package.json
  const pkgJsonPath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(pkgJsonPath)) {
    return { indexed: 0, symbols: 0, errors: 0 };
  }

  let pkgJson: Record<string, any>;
  try {
    pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
  } catch {
    return { indexed: 0, symbols: 0, errors: 0 };
  }

  const depNames = parseDependenciesFromPkg(pkgJson, includeDev ?? false);
  if (depNames.length === 0) {
    return { indexed: 0, symbols: 0, errors: 0 };
  }

  const db = openDb(dbPath);
  let indexedCount = 0;
  let symbolCount = 0;
  let errorCount = 0;

  try {
    for (const name of depNames) {
      const lib = locateLibrary(projectRoot, name);
      if (!lib) {
        // Dep missing from node_modules — skip silently
        continue;
      }

      const version = lib.version;
      const libDirName = `${name}@${version}`;
      const libCardDir = path.join(libsDir, libDirName);

      // Check if this exact version is already indexed (idempotency check)
      if (fs.existsSync(libCardDir) && isVersionIndexed(db, name, version)) {
        // Already up-to-date — skip
        indexedCount++;
        continue;
      }

      // Prune old version if the version changed
      pruneOldVersion(db, libsDir, name, version);

      // Create card directory
      fs.mkdirSync(libCardDir, { recursive: true });

      // Upsert library record
      upsertLibrary(db, {
        name,
        version,
        source: "node_modules",
        dts_path: lib.dtsPath,
        readme: lib.readmePath ? readFirstLines(lib.readmePath, 5) : null,
      });

      const symbols: LibSymbol[] = [];

      // Extract from .d.ts if available
      if (lib.dtsPath) {
        try {
          const source = fs.readFileSync(lib.dtsPath, "utf-8");
          const extracted = extractDtsSymbols(source, name, version);
          symbols.push(...extracted);
        } catch {
          // d.ts parse error — skip silently
        }
      }

      // If no .d.ts symbols and we have README, create a module overview card
      if (symbols.length === 0 && lib.readmePath) {
        const readmeText = fs.readFileSync(lib.readmePath, "utf-8");
        const summary = readmeText.split("\n").slice(0, 5).join("\n").trim() || `${name} library`;
        symbols.push({
          lib: name,
          version,
          name,
          kind: "module",
          signature: "",
          doc: readmeText.slice(0, 2000),
          summary,
          card_path: "",
        });
      }

      // Write cards and insert symbols
      for (const sym of symbols) {
        const cardFileName = `${sanitizeName(sym.name)}.md`;
        const cardPath = path.join(libCardDir, cardFileName);

        const card = renderLibCard(sym);
        const tmpPath = cardPath + ".tmp";
        fs.writeFileSync(tmpPath, card, { encoding: "utf-8", mode: 0o600 });
        fs.renameSync(tmpPath, cardPath);

        sym.card_path = cardPath;
        upsertLibSymbol(db, sym);
      }

      indexedCount++;
      symbolCount += symbols.length;
    }

    setMeta(db, "last_libs_index", new Date().toISOString());
  } catch (e) {
    errorCount++;
  } finally {
    db.close();
  }

  return { indexed: indexedCount, symbols: symbolCount, errors: errorCount };
}

/**
 * Rebuild the lib_symbols DB tables from cards alone.
 * Used for the disposable-index property.
 */
export function rebuildLibDbFromCards(
  dbPath: string,
  libsDir: string,
): void {
  if (!fs.existsSync(libsDir)) return;

  const db = openDb(dbPath);

  try {
    db.exec("BEGIN TRANSACTION");

    // Walk all <pkg>@<version>/ directories
    for (const libDir of fs.readdirSync(libsDir, { withFileTypes: true })) {
      if (!libDir.isDirectory()) continue;

      const fullLibDir = path.join(libsDir, libDir.name);
      const atIndex = libDir.name.lastIndexOf("@");
      if (atIndex < 0) continue;

      const libName = libDir.name.slice(0, atIndex);
      const version = libDir.name.slice(atIndex + 1);

      // Upsert library record
      upsertLibrary(db, { name: libName, version, source: "node_modules", dts_path: null, readme: null });

      // Walk .md cards
      for (const entry of fs.readdirSync(fullLibDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;

        const cardPath = path.join(fullLibDir, entry.name);
        const cardText = fs.readFileSync(cardPath, "utf-8");
        const parsed = parseCard(cardText);
        if (!parsed) continue;

        const { head } = parsed;

        upsertLibSymbol(db, {
          lib: libName,
          version,
          name: head.name,
          kind: head.kind,
          signature: head.signature,
          doc: parsed.body,
          summary: head.summary,
          card_path: cardPath,
        });
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

// ── Internal helpers ───────────────────────────────────────────

function parseDependenciesFromPkg(
  pkgJson: Record<string, any>,
  includeDev: boolean,
): string[] {
  const deps: string[] = [];
  if (pkgJson.dependencies) {
    deps.push(...Object.keys(pkgJson.dependencies));
  }
  if (includeDev && pkgJson.devDependencies) {
    deps.push(...Object.keys(pkgJson.devDependencies));
  }
  return deps;
}

/** Check if a library+version is already in the DB (idempotent guard). */
function isVersionIndexed(db: any, libName: string, version: string): boolean {
  try {
    const row = db.prepare(
      "SELECT 1 FROM libraries WHERE name = ? AND version = ?",
    ).get(libName, version);
    return !!row;
  } catch {
    return false;
  }
}

/** Remove old card dir and DB rows for a library when version changes. */
function pruneOldVersion(
  db: any,
  libsDir: string,
  libName: string,
  newVersion: string,
): void {
  // Find any existing card dir for this lib with a different version
  if (!fs.existsSync(libsDir)) return;

  for (const dir of fs.readdirSync(libsDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const prefix = `${libName}@`;
    if (dir.name.startsWith(prefix) && dir.name !== `${libName}@${newVersion}`) {
      // Remove old card dir
      const oldDir = path.join(libsDir, dir.name);
      try {
        fs.rmSync(oldDir, { recursive: true, force: true });
      } catch { /* best effort */ }
    }
  }

  // Delete old DB rows for this lib (all versions — we'll re-insert with new version)
  try {
    deleteLibrary(db, libName);
  } catch { /* best effort */ }
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_$]/g, "_");
}

function readFirstLines(filePath: string, n: number): string {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return content.split("\n").slice(0, n).join("\n").trim();
  } catch {
    return "";
  }
}
