/**
 * Project identity + path layout for codewalker.
 *
 * The working tree stays clean: the only artifact written into <cwd>/.pi is a single identifier
 * file `<project-id>.md`. Everything else (codewalker index, cards, meta) lives globally
 * under ~/.pi/projects/<project-id>/codewalker/.
 *
 * The project id is deterministic from the project root path (`<slug>-<hash>`) so it is stable
 * across runs; if the marker already records an id (e.g. the directory was moved), that id wins,
 * so codewalker follows the project rather than the path.
 *
 * This module is adapted from @aprimediet/memory's project.ts — same id algorithm, same marker,
 * different per-extension subdirectory.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const CONFIG_DIR_NAME = ".pi";

export interface ProjectPaths {
  id: string;
  root: string;
  configDir: string;
  markerPath: string;
  globalDir: string;
  codewalkerDir: string;
  dbPath: string;
  metaFile: string;
  entriesDir: string;
  symbolsDir: string;
  libsDir: string;
  glossaryDir: string;
  decisionsDir: string;
  analysisDir: string;
  conventionsDir: string;
}

function piHome(): string {
  // Try common pi home locations; fallback to ~/.pi
  const homePi = path.join(osHomedir(), ".pi");
  const projects = path.join(homePi, "projects");
  // If ~/.pi exists and has a projects/ dir, use it
  if (fs.existsSync(projects)) return homePi;
  // Otherwise create it
  fs.mkdirSync(projects, { recursive: true });
  return homePi;
}

function osHomedir(): string {
  return process.env.HOME || process.env.USERPROFILE || "/root";
}

export function projectsRoot(): string {
  return path.join(piHome(), "projects");
}

function slug(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "project";
}

function pathHash(abs: string): string {
  return crypto.createHash("sha1").update(abs).digest("hex").slice(0, 8);
}

function findProjectRoot(cwd: string): string {
  let dir = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(dir, CONFIG_DIR_NAME)) || fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return cwd;
    dir = parent;
  }
}

/** Read an existing marker (a .pi/*.md file with `pi-project: true`); return its id + file. */
function readMarker(configDir: string): { id: string; file: string } | null {
  if (!fs.existsSync(configDir)) return null;
  let names: string[];
  try {
    names = fs.readdirSync(configDir).filter((n) => n.endsWith(".md"));
  } catch {
    return null;
  }
  for (const name of names) {
    const file = path.join(configDir, name);
    try {
      const content = fs.readFileSync(file, "utf-8");
      const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
      if (!match) continue;
      const fm = match[1] as string;
      const lines = fm.split("\n");
      const fmObj: Record<string, string> = {};
      for (const line of lines) {
        const sep = line.indexOf(":");
        if (sep > 0) {
          const key = line.slice(0, sep).trim();
          const val = line.slice(sep + 1).trim();
          fmObj[key] = val;
        }
      }
      if (fmObj["pi-project"] === "true" && fmObj["id"]) {
        return { id: fmObj["id"], file };
      }
    } catch {
      /* not a marker */
    }
  }
  return null;
}

function pathsForId(id: string, root: string, configDir: string, markerPath: string): ProjectPaths {
  const globalDir = path.join(projectsRoot(), id);
  return {
    id,
    root,
    configDir,
    markerPath,
    globalDir,
    codewalkerDir: path.join(globalDir, "codewalker"),
    dbPath: path.join(globalDir, "codewalker", "index.db"),
    metaFile: path.join(globalDir, "codewalker", "meta.json"),
    entriesDir: path.join(globalDir, "codewalker", "entries"),
    symbolsDir: path.join(globalDir, "codewalker", "entries", "symbols"),
    libsDir: path.join(globalDir, "codewalker", "entries", "libs"),
    glossaryDir: path.join(globalDir, "codewalker", "entries", "glossary"),
    decisionsDir: path.join(globalDir, "codewalker", "entries", "decisions"),
    analysisDir: path.join(globalDir, "codewalker", "entries", "analysis"),
    conventionsDir: path.join(globalDir, "codewalker", "entries", "conventions"),
  };
}

/** Resolve project identity for a cwd (read-only — does not create anything). */
export function resolveProject(cwd: string): ProjectPaths {
  const root = findProjectRoot(cwd);
  const configDir = path.join(root, CONFIG_DIR_NAME);
  const existing = readMarker(configDir);
  const id = existing?.id ?? `${slug(path.basename(root))}-${pathHash(root)}`;
  const markerPath = existing?.file ?? path.join(configDir, `${id}.md`);
  return pathsForId(id, root, configDir, markerPath);
}

function markerBody(id: string, createdISO: string): string {
  return [
    "---",
    "pi-project: true",
    `id: ${id}`,
    `created: ${createdISO}`,
    "---",
    "# pi codewalker project",
    "",
    "This file marks this directory as a pi codewalker project. To keep your working tree clean,",
    "all codewalker artifacts are stored globally — NOT here — under:",
    "",
    `    ~/.pi/projects/${id}/codewalker/`,
    "",
    "- `index.db`       disposable SQLite+FTS5 index",
    "- `meta.json`      last-indexed commit and schema version",
    "- `entries/`       markdown cards (source of truth)",
    "",
    "Managed by @aprimediet/codewalker. Safe to commit (stable id) and safe to delete (recreated).",
    "",
  ].join("\n");
}

/** Create the global directory structure + the cwd marker (idempotent). Returns the paths. */
export async function ensureProject(cwd: string): Promise<ProjectPaths> {
  const p = resolveProject(cwd);
  const nowISO = new Date().toISOString();

  for (const dir of [p.codewalkerDir, p.entriesDir, p.symbolsDir, p.libsDir, p.glossaryDir, p.decisionsDir, p.analysisDir, p.conventionsDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // marker in cwd (the only thing we write into the working tree)
  if (!fs.existsSync(p.markerPath)) {
    fs.mkdirSync(p.configDir, { recursive: true });
    const tmp = `${p.markerPath}.tmp`;
    fs.writeFileSync(tmp, markerBody(p.id, nowISO), { encoding: "utf-8", mode: 0o644 });
    fs.renameSync(tmp, p.markerPath);
  }

  // meta.json — track every path this project has been seen at
  interface ProjectMeta {
    id: string;
    name: string;
    paths: string[];
    created: string;
    lastSeen: string;
  }
  let meta: ProjectMeta = { id: p.id, name: path.basename(p.root), paths: [], created: nowISO, lastSeen: nowISO };
  try {
    meta = { ...meta, ...(JSON.parse(fs.readFileSync(p.metaFile, "utf-8")) as ProjectMeta) };
  } catch {
    /* first run */
  }
  if (!meta.paths.includes(p.root)) meta.paths.push(p.root);
  meta.lastSeen = nowISO;
  try {
    const tmp = `${p.metaFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(meta, null, 2), { encoding: "utf-8", mode: 0o600 });
    fs.renameSync(tmp, p.metaFile);
  } catch {
    /* non-fatal */
  }

  return p;
}
