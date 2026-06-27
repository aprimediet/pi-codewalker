/**
 * Tests for libs/indexer.ts — library indexer.
 *
 * Integration tests using a fixture project with a fake node_modules.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { indexLibraries, rebuildLibDbFromCards } from "./indexer.ts";
import { openDb, searchLibSymbols, getMeta } from "../db.ts";

describe("indexLibraries", () => {
  let tmpDir: string;
  let projectRoot: string;
  let libsDir: string;
  let dbPath: string;
  let nodeModulesDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-idx-"));
    projectRoot = path.join(tmpDir, "project");
    libsDir = path.join(tmpDir, "codewalker", "entries", "libs");
    dbPath = path.join(tmpDir, "codewalker", "index.db");
    nodeModulesDir = path.join(projectRoot, "node_modules");

    fs.mkdirSync(nodeModulesDir, { recursive: true });
    fs.mkdirSync(libsDir, { recursive: true });

    // Write a project package.json
    fs.writeFileSync(
      path.join(projectRoot, "package.json"),
      JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "typed-pkg": "^1.0.0",
          "no-dts-pkg": "^2.0.0",
        },
      }),
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function installTypedPkg(): void {
    const pkgDir = path.join(nodeModulesDir, "typed-pkg");
    fs.mkdirSync(path.join(pkgDir, "dist"), { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "typed-pkg", version: "1.2.0", types: "dist/index.d.ts" }),
    );
    fs.writeFileSync(
      path.join(pkgDir, "dist", "index.d.ts"),
      [
        "/** A typed greeting function. */",
        "export declare function greet(name: string): string;",
        "/** Configuration options. */",
        "export interface Config { port: number; }",
        "export const VERSION: string;",
      ].join("\n"),
    );
    fs.writeFileSync(pkgDir + "/README.md", "# typed-pkg\nA typed package for testing.\n");
  }

  function installNoDtsPkg(): void {
    const pkgDir = path.join(nodeModulesDir, "no-dts-pkg");
    fs.mkdirSync(pkgDir);
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "no-dts-pkg", version: "2.1.0", main: "index.js" }),
    );
    fs.writeFileSync(path.join(pkgDir, "index.js"), "module.exports = {};\n");
    fs.writeFileSync(path.join(pkgDir, "README.md"), "# no-dts-pkg\nA JS-only package.\n");
  }

  it("indexes typed dependency: writes cards and populates DB", async () => {
    installTypedPkg();

    const result = await indexLibraries({ projectRoot, libsDir, dbPath });
    expect(result.indexed).toBe(1);
    expect(result.symbols).toBe(3);
    expect(result.errors).toBe(0);

    // Check cards exist
    const pkgCardDir = path.join(libsDir, "typed-pkg@1.2.0");
    expect(fs.existsSync(pkgCardDir)).toBe(true);
    const cardFiles = fs.readdirSync(pkgCardDir);
    // greet, Config, VERSION
    expect(cardFiles).toHaveLength(3);

    // Check DB
    const db = openDb(dbPath);
    const symbols = searchLibSymbols(db, "", undefined, 10);
    expect(symbols).toHaveLength(3);
    expect(symbols.map(s => s.name)).toContain("greet");
    expect(symbols.map(s => s.name)).toContain("Config");
    expect(symbols.map(s => s.name)).toContain("VERSION");
    expect(symbols[0]!.lib).toBe("typed-pkg");
    expect(symbols[0]!.version).toBe("1.2.0");
    db.close();
  });

  it("indexes a README-only dependency (no .d.ts)", async () => {
    installNoDtsPkg();

    const result = await indexLibraries({ projectRoot, libsDir, dbPath });
    // Only no-dts-pkg is installed; typed-pkg missing from node_modules so skipped
    expect(result.indexed).toBe(1);
    expect(result.symbols).toBeGreaterThanOrEqual(1); // at least the module card
    expect(result.errors).toBe(0);

    // Check README-only package got a module card
    const pkgCardDir = path.join(libsDir, "no-dts-pkg@2.1.0");
    expect(fs.existsSync(pkgCardDir)).toBe(true);
    const cardFiles = fs.readdirSync(pkgCardDir);
    // Should have a module card (README summary)
    expect(cardFiles.length).toBeGreaterThanOrEqual(1);
  });

  it("is idempotent: re-running produces no duplicates", async () => {
    installTypedPkg();

    await indexLibraries({ projectRoot, libsDir, dbPath });
    await indexLibraries({ projectRoot, libsDir, dbPath });

    const db = openDb(dbPath);
    const symbols = searchLibSymbols(db, "", undefined, 10);
    expect(symbols).toHaveLength(3);
    db.close();
  });

  it("handles missing node_modules gracefully", async () => {
    // Remove node_modules
    fs.rmSync(nodeModulesDir, { recursive: true, force: true });

    const result = await indexLibraries({ projectRoot, libsDir, dbPath });
    expect(result.indexed).toBe(0);
    expect(result.symbols).toBe(0);
    expect(result.errors).toBe(0);
  });

  it("handles a dep that is missing from node_modules with a logged note", async () => {
    // Only install one of the two deps
    installTypedPkg();
    // no-dts-pkg is missing from node_modules

    const result = await indexLibraries({ projectRoot, libsDir, dbPath });
    // Should index typed-pkg, skip no-dts-pkg
    expect(result.indexed).toBe(1);
    expect(result.errors).toBe(0);
  });

  it("includes devDependencies when includeDev=true", async () => {
    // Add a dev dependency
    const pkgJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"));
    pkgJson.devDependencies = { "dev-pkg": "^3.0.0" };
    fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify(pkgJson));

    // Install dev-pkg (typed)
    const devPkgDir = path.join(nodeModulesDir, "dev-pkg");
    fs.mkdirSync(devPkgDir);
    fs.writeFileSync(
      path.join(devPkgDir, "package.json"),
      JSON.stringify({ name: "dev-pkg", version: "3.0.0" }),
    );
    fs.writeFileSync(path.join(devPkgDir, "index.d.ts"), "export const devVar: number;\n");

    // Install other deps too
    installTypedPkg();

    const result = await indexLibraries({ projectRoot, libsDir, dbPath, includeDev: true });
    // typed-pkg + dev-pkg (no-dts-pkg missing from node_modules so skipped silently)
    expect(result.indexed).toBe(2);
    expect(result.symbols).toBeGreaterThanOrEqual(4); // 3 from typed-pkg + 1 from dev-pkg
  });

  it("rebuildLibDbFromCards repopulates lib_symbols from cards", async () => {
    installTypedPkg();
    await indexLibraries({ projectRoot, libsDir, dbPath });

    // Delete the DB and recreate from cards
    const oldDb = openDb(dbPath);
    oldDb.exec("DELETE FROM lib_symbols; DELETE FROM lib_symbols_fts; DELETE FROM libraries;");
    oldDb.close();

    rebuildLibDbFromCards(dbPath, libsDir);

    const db = openDb(dbPath);
    const symbols = searchLibSymbols(db, "", undefined, 10);
    expect(symbols).toHaveLength(3);
    db.close();
  });

  it("version bump prunes old cards+rows and adds new", async () => {
    // Install v1
    const pkgDir = path.join(nodeModulesDir, "typed-pkg");
    fs.mkdirSync(path.join(pkgDir, "dist"), { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "typed-pkg", version: "1.0.0", types: "dist/index.d.ts" }),
    );
    fs.writeFileSync(path.join(pkgDir, "dist", "index.d.ts"), "export const OLD: number;\n");

    await indexLibraries({ projectRoot, libsDir, dbPath });

    // Check v1 card exists
    expect(fs.existsSync(path.join(libsDir, "typed-pkg@1.0.0"))).toBe(true);

    // Now "upgrade" to v2
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "typed-pkg", version: "2.0.0", types: "dist/index.d.ts" }),
    );
    fs.writeFileSync(path.join(pkgDir, "dist", "index.d.ts"), "export const NEW: number;\n");

    await indexLibraries({ projectRoot, libsDir, dbPath });

    // Old card dir should be gone
    expect(fs.existsSync(path.join(libsDir, "typed-pkg@1.0.0"))).toBe(false);

    // New card dir exists
    expect(fs.existsSync(path.join(libsDir, "typed-pkg@2.0.0"))).toBe(true);

    // DB has new symbols only
    const db = openDb(dbPath);
    const symbols = searchLibSymbols(db, "", undefined, 10);
    expect(symbols).toHaveLength(1);
    expect(symbols[0]!.name).toBe("NEW");
    expect(symbols[0]!.version).toBe("2.0.0");
    db.close();
  });
});
