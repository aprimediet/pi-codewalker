/**
 * Compatibility probe: detect if @aprimediet/minion and @aprimediet/memory are active
 * for this project by reading the shared .pi/<project-id>.md marker and probing
 * global directories.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

export interface CompatResult {
	projectId: string | null;
	minionActive: boolean;
	memoryActive: boolean;
	memoryEntries: number;
	openTaskCount: number;
	openTaskSummary: string;
	memorySummary: string;
}

/**
 * Walk upward from cwd until we find a dir containing .pi/ or .git/.
 * Return cwd if root is reached without finding either.
 */
function findProjectRoot(cwd: string): string {
	let dir = cwd;
	for (;;) {
		const piPath = path.join(dir, CONFIG_DIR_NAME);
		const gitPath = path.join(dir, ".git");
		if (fs.existsSync(piPath) || fs.existsSync(gitPath)) {
			return dir;
		}
		const parent = path.dirname(dir);
		if (parent === dir) {
			// reached filesystem root
			return cwd;
		}
		dir = parent;
	}
}

/**
 * Scan <configDir>/*.md files for one with frontmatter containing pi-project: true.
 * Return that file's id: value, or null if none found.
 */
function readMarkerId(configDir: string): string | null {
	if (!fs.existsSync(configDir)) {
		return null;
	}

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
			const { frontmatter } = parseFrontmatter<Record<string, string>>(content);
			if (frontmatter && String(frontmatter["pi-project"]) === "true" && frontmatter.id) {
				return frontmatter.id;
			}
		} catch {
			// not a valid marker, skip
		}
	}

	return null;
}

/**
 * Extract status and title from task frontmatter.
 * Return { status, title } or null if cannot parse.
 * title may be undefined if missing from frontmatter; callers should supply a fallback.
 */
function parseTaskMetadata(content: string): { status: string; title: string | undefined } | null {
	try {
		const { frontmatter } = parseFrontmatter<Record<string, string>>(content);
		if (!frontmatter) return null;
		const status = frontmatter.status || "";
		const title = frontmatter.title || undefined;
		if (!status) return null;
		return { status, title };
	} catch {
		return null;
	}
}

/**
 * Probe minion integration: check if <globalDir>/tasks/ exists and has open tasks.
 * Return { openTasks, openTaskSummary } or null if minion is not active.
 */
function probeMinionTasks(globalDir: string): { openTasks: number; openTaskSummary: string } | null {
	const tasksDir = path.join(globalDir, "tasks");

	// If tasks dir doesn't exist, minion is not active for this project
	if (!fs.existsSync(tasksDir)) {
		return null;
	}

	const OPEN_STATUSES = new Set(["backlog", "todo", "in_progress", "blocked", "review"]);
	const openTasks: string[] = [];

	try {
		const names = fs.readdirSync(tasksDir);
		for (const name of names) {
			if (!name.endsWith(".md")) continue;
			const file = path.join(tasksDir, name);
			try {
				const content = fs.readFileSync(file, "utf-8");
				const meta = parseTaskMetadata(content);
				if (meta && OPEN_STATUSES.has(meta.status)) {
					const taskTitle = meta.title ?? name.replace(/\.md$/, "");
					openTasks.push(`${meta.status}: ${taskTitle}`);
					if (openTasks.length >= 10) break;
				}
			} catch {
				// skip unparseable files
			}
		}
	} catch {
		// tasks dir exists but is unreadable — still report as active
	}

	const summary = openTasks.length > 0 ? openTasks.join("\n") : "(no open tasks)";
	return { openTasks: openTasks.length, openTaskSummary: summary };
}

/**
 * Probe memory integration: check if <globalDir>/memory/ exists and count entries.
 * Also read MEMORY.md (up to 3000 chars).
 * Return { entries, memorySummary } or null if memory is not active.
 */
function probeMemoryIntegration(globalDir: string): { entries: number; memorySummary: string } | null {
	const memoryDir = path.join(globalDir, "memory");

	// If memory dir doesn't exist, memory is not active for this project
	if (!fs.existsSync(memoryDir)) {
		return null;
	}

	// Count entries in memory/entries/
	let entriesCount = 0;
	const entriesDir = path.join(memoryDir, "entries");
	try {
		if (fs.existsSync(entriesDir)) {
			const files = fs.readdirSync(entriesDir);
			entriesCount = files.filter((f) => f.endsWith(".md")).length;
		}
	} catch {
		// entries dir unreadable, but memory is still active
	}

	// Read MEMORY.md (truncated at 3000 chars)
	let memorySummary = "";
	const memoryFile = path.join(memoryDir, "MEMORY.md");
	try {
		if (fs.existsSync(memoryFile)) {
			const content = fs.readFileSync(memoryFile, "utf-8");
			memorySummary = content.length > 3000 ? content.slice(0, 3000) : content;
		}
	} catch {
		// MEMORY.md unreadable
	}

	return { entries: entriesCount, memorySummary };
}

/**
 * Probe compatibility: detect minion and memory integration for the project at cwd.
 * Return detailed status for both extensions in a flat structure.
 */
export function probeCompat(cwd: string): CompatResult {
	const root = findProjectRoot(cwd);
	const configDir = path.join(root, CONFIG_DIR_NAME);
	const projectId = readMarkerId(configDir);

	// Initialize with defaults
	const base: CompatResult = {
		projectId,
		minionActive: false,
		memoryActive: false,
		memoryEntries: 0,
		openTaskCount: 0,
		openTaskSummary: "",
		memorySummary: "",
	};

	// If no project marker, return defaults
	if (!projectId) {
		return base;
	}

	const piHome = path.dirname(getAgentDir());
	const globalDir = path.join(piHome, "projects", projectId);

	// Probe minion
	const minionProbe = probeMinionTasks(globalDir);
	if (minionProbe) {
		base.minionActive = true;
		base.openTaskCount = minionProbe.openTasks;
		base.openTaskSummary = minionProbe.openTaskSummary;
	}

	// Probe memory
	const memoryProbe = probeMemoryIntegration(globalDir);
	if (memoryProbe) {
		base.memoryActive = true;
		base.memoryEntries = memoryProbe.entries;
		base.memorySummary = memoryProbe.memorySummary;
	}

	return base;
}
