/**
 * Library dependency discovery for codewalker v1.2.
 *
 * - `parseDependencies(pkgJson, includeDev?)`: PURE — extract dep names from package.json.
 * - `resolveTypesEntry(pkgJson)`: PURE — find the .d.ts entry point.
 * - `locateLibrary(projectRoot, name)`: integration — read the installed package info.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface LocateResult {
  version: string;
  dtsPath: string | null;
  readmePath: string | null;
}

/**
 * Extract dependency names from a package.json object.
 * By default returns only `dependencies`; set `includeDev=true` to add `devDependencies`.
 * Ignores peerDependencies and optionalDependencies.
 * PURE — no I/O.
 */
export function parseDependencies(
  pkgJson: Record<string, any> | null | undefined,
  includeDev = false,
): string[] {
  if (!pkgJson) return [];

  const deps: string[] = [];

  if (pkgJson.dependencies) {
    deps.push(...Object.keys(pkgJson.dependencies));
  }

  if (includeDev && pkgJson.devDependencies) {
    deps.push(...Object.keys(pkgJson.devDependencies));
  }

  return deps;
}

/**
 * Resolve the `.d.ts` entry point for a package.
 * Priority: `types` → `typings` → `index.d.ts` → derive from `main` (swap .js for .d.ts).
 * Returns a relative path string.
 * PURE — no I/O.
 */
export function resolveTypesEntry(
  pkgJson: Record<string, any> | null | undefined,
): string {
  if (!pkgJson) return "index.d.ts";

  if (pkgJson.types) return pkgJson.types;
  if (pkgJson.typings) return pkgJson.typings;

  // Derive from `main` if present
  if (pkgJson.main) {
    const main = pkgJson.main as string;
    // Swap .js|.mjs|.cjs endings for .d.ts; otherwise append .d.ts
    if (/\.(js|mjs|cjs)$/.test(main)) {
      return main.replace(/\.(js|mjs|cjs)$/, ".d.ts");
    }
    return main + ".d.ts";
  }

  return "index.d.ts";
}

/**
 * Locate an installed library in `node_modules/<name>`.
 * Returns null if the package or its directory does not exist.
 * Integration — reads the filesystem.
 */
export function locateLibrary(
  projectRoot: string,
  name: string,
): LocateResult | null {
  const nmDir = path.join(projectRoot, "node_modules");
  if (!fs.existsSync(nmDir)) return null;

  const pkgDir = path.join(nmDir, name);
  const pkgJsonPath = path.join(pkgDir, "package.json");

  if (!fs.existsSync(pkgJsonPath)) return null;

  let pkgJson: Record<string, any>;
  try {
    pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
  } catch {
    return null;
  }

  const version = pkgJson.version ?? "unknown";

  // Resolve .d.ts path
  const typesRel = resolveTypesEntry(pkgJson);
  let dtsPath: string | null = path.join(pkgDir, typesRel);
  if (!fs.existsSync(dtsPath)) {
    // Try common alternative locations
    const altDts = path.join(pkgDir, "index.d.ts");
    if (fs.existsSync(altDts)) {
      dtsPath = altDts;
    } else {
      dtsPath = null;
    }
  }

  // Find README (case-insensitive)
  let readmePath: string | null = null;
  for (const name of ["README.md", "readme.md", "Readme.md"]) {
    const candidate = path.join(pkgDir, name);
    if (fs.existsSync(candidate)) {
      readmePath = candidate;
      break;
    }
  }

  return { version, dtsPath, readmePath };
}
