/**
 * Tests for libs/resolve.ts — library dependency discovery.
 *
 * Covers:
 * - PURE parseDependencies (deps / deps+devDeps)
 * - PURE resolveTypesEntry (types → typings → index.d.ts → main)
 * - Integration locateLibrary over a fixture node_modules
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parseDependencies, resolveTypesEntry, locateLibrary } from "./resolve.ts";

// ── PURE: parseDependencies ────────────────────────────────────
describe("parseDependencies", () => {
  it("returns names from `dependencies`", () => {
    const pkg = { dependencies: { express: "^4.0.0", lodash: "^4.17.0" } };
    const result = parseDependencies(pkg);
    expect(result).toEqual(["express", "lodash"]);
  });

  it("returns empty array when no dependencies", () => {
    expect(parseDependencies({})).toEqual([]);
  });

  it("ignores devDependencies by default", () => {
    const pkg = {
      dependencies: { express: "^4.0.0" },
      devDependencies: { vitest: "^1.0.0" },
    };
    expect(parseDependencies(pkg)).toEqual(["express"]);
  });

  it("includes devDependencies when includeDev=true", () => {
    const pkg = {
      dependencies: { express: "^4.0.0" },
      devDependencies: { vitest: "^1.0.0", typescript: "^5.0.0" },
    };
    const result = parseDependencies(pkg, true);
    expect(result).toContain("express");
    expect(result).toContain("vitest");
    expect(result).toContain("typescript");
    expect(result).toHaveLength(3);
  });

  it("ignores peerDependencies and optionalDependencies", () => {
    const pkg = {
      dependencies: { express: "^4.0.0" },
      peerDependencies: { react: "^18.0.0" },
      optionalDependencies: { fsevents: "^2.0.0" },
    };
    expect(parseDependencies(pkg)).toEqual(["express"]);
  });

  it("returns empty array for null/undefined input", () => {
    expect(parseDependencies(null as any)).toEqual([]);
    expect(parseDependencies(undefined as any)).toEqual([]);
  });
});

// ── PURE: resolveTypesEntry ────────────────────────────────────
describe("resolveTypesEntry", () => {
  it("prefers `types` field", () => {
    const pkg = { types: "dist/index.d.ts", typings: "lib/index.d.ts" };
    expect(resolveTypesEntry(pkg)).toBe("dist/index.d.ts");
  });

  it("falls back to `typings` field", () => {
    const pkg = { typings: "lib/index.d.ts" };
    expect(resolveTypesEntry(pkg)).toBe("lib/index.d.ts");
  });

  it("falls back to `index.d.ts`", () => {
    const pkg = {};
    expect(resolveTypesEntry(pkg)).toBe("index.d.ts");
  });

  it("derives from `main` by swapping .js for .d.ts", () => {
    const pkg = { main: "dist/main.js" };
    expect(resolveTypesEntry(pkg)).toBe("dist/main.d.ts");
  });

  it("handles main with no extension by appending .d.ts", () => {
    const pkg = { main: "dist/main" };
    expect(resolveTypesEntry(pkg)).toBe("dist/main.d.ts");
  });

  it("returns index.d.ts when main is not present", () => {
    const pkg = {};
    expect(resolveTypesEntry(pkg)).toBe("index.d.ts");
  });
});

// ── Integration: locateLibrary ─────────────────────────────────
describe("locateLibrary", () => {
  let tmpDir: string;
  let projectRoot: string;
  let nodeModulesDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-resolve-"));
    projectRoot = path.join(tmpDir, "my-project");
    nodeModulesDir = path.join(projectRoot, "node_modules");
    fs.mkdirSync(nodeModulesDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns version, dtsPath, and readmePath for a typed package", () => {
    // Create a typed package
    const pkgDir = path.join(nodeModulesDir, "typed-pkg");
    fs.mkdirSync(path.join(pkgDir, "dist"), { recursive: true });

    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        name: "typed-pkg",
        version: "2.1.0",
        types: "dist/index.d.ts",
        main: "dist/index.js",
      }),
    );

    fs.writeFileSync(
      path.join(pkgDir, "dist", "index.d.ts"),
      "export declare function hello(): void;\n",
    );

    fs.writeFileSync(
      path.join(pkgDir, "README.md"),
      "# typed-pkg\nA typed package.\n",
    );

    const result = locateLibrary(projectRoot, "typed-pkg");
    expect(result).not.toBeNull();
    expect(result!.version).toBe("2.1.0");
    expect(result!.dtsPath).toBe(path.join(pkgDir, "dist", "index.d.ts"));
    expect(result!.readmePath).toBe(path.join(pkgDir, "README.md"));
  });

  it("returns null for a non-existent package", () => {
    const result = locateLibrary(projectRoot, "non-existent-pkg");
    expect(result).toBeNull();
  });

  it("returns null when node_modules does not exist", () => {
    const noNodeModules = path.join(tmpDir, "empty-project");
    fs.mkdirSync(noNodeModules);
    const result = locateLibrary(noNodeModules, "anything");
    expect(result).toBeNull();
  });

  it("returns dtsPath=null for a package with no .d.ts file", () => {
    // JS-only package, no types
    const pkgDir = path.join(nodeModulesDir, "js-only");
    fs.mkdirSync(pkgDir);

    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        name: "js-only",
        version: "0.5.0",
        main: "index.js",
      }),
    );

    // Create the JS file but no .d.ts
    fs.writeFileSync(path.join(pkgDir, "index.js"), "module.exports = {};\n");

    // Also no README
    const result = locateLibrary(projectRoot, "js-only");
    expect(result).not.toBeNull();
    expect(result!.version).toBe("0.5.0");
    expect(result!.dtsPath).toBeNull();
    expect(result!.readmePath).toBeNull();
  });

  it("finds README.md case-insensitively (README.md or readme.md)", () => {
    const pkgDir = path.join(nodeModulesDir, "readme-case");
    fs.mkdirSync(path.join(pkgDir, "dist"), { recursive: true });

    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "readme-case", version: "1.0.0" }),
    );

    // Only readme.md (lowercase)
    fs.writeFileSync(path.join(pkgDir, "readme.md"), "# Lowercase readme\n");

    // Need index.d.ts so it doesn't return null
    fs.writeFileSync(path.join(pkgDir, "index.d.ts"), "export const foo: number;\n");

    const result = locateLibrary(projectRoot, "readme-case");
    expect(result).not.toBeNull();
    expect(result!.readmePath).toBe(path.join(pkgDir, "readme.md"));
  });

  it("resolves package.json even without types field (uses index.d.ts fallback)", () => {
    const pkgDir = path.join(nodeModulesDir, "no-types-field");
    fs.mkdirSync(pkgDir);

    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "no-types-field", version: "3.0.0" }),
    );

    fs.writeFileSync(path.join(pkgDir, "index.d.ts"), "export const bar: boolean;\n");

    const result = locateLibrary(projectRoot, "no-types-field");
    expect(result).not.toBeNull();
    expect(result!.version).toBe("3.0.0");
    expect(result!.dtsPath).toBe(path.join(pkgDir, "index.d.ts"));
  });
});
