import * as fs from "node:fs";
import * as path from "node:path";

// Agent-facing guide lives at the repo root by convention (AGENTS.md), with a thin
// CLAUDE.md pointer next to it so Claude Code auto-imports the same source of truth.
const AGENTS_CANDIDATES = ["AGENTS.md", ".agents/AGENTS.md", "docs/AGENTS.md"];
const CLAUDE_CANDIDATES = ["CLAUDE.md", ".claude/CLAUDE.md"];

export function findExistingAgentsMd(root: string): string | null {
  for (const p of AGENTS_CANDIDATES) {
    const filePath = path.join(root, p);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
}

export function findExistingClaudeMd(root: string): string | null {
  for (const p of CLAUDE_CANDIDATES) {
    const filePath = path.join(root, p);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
}

export function createAgentsMd(root: string, content: string): string {
  const outPath = path.join(root, "AGENTS.md");
  fs.writeFileSync(outPath, content, "utf-8");
  return outPath;
}

export function createClaudeMd(root: string, content: string): string {
  const outPath = path.join(root, "CLAUDE.md");
  fs.writeFileSync(outPath, content, "utf-8");
  return outPath;
}

/**
 * The agent-facing engineering guide. This is the "how to work in this repo" document:
 * tech stack, structure, commands, conventions, technical boundaries, gotchas, and how
 * the agent should use the minion/memory companion extensions. Product "what & why"
 * (goals, users, features, metrics) belongs in the PRD, not here.
 */
export function agentsMdTemplate(p: {
  projectName: string;
  summary: string;
  techStack: string;
  structure: string;
  commands: { setup?: string; build?: string; test?: string; run?: string; lint?: string };
  conventions: string;
  boundaries: string;
  knownIssues: string[];
  integration: string;
  currentFocus: string;
  prdPath: string | null;
}): string {
  const cmd = p.commands;
  const commandRows = [
    cmd.setup ? `- **Setup:** \`${cmd.setup}\`` : null,
    cmd.build ? `- **Build:** \`${cmd.build}\`` : null,
    cmd.test ? `- **Test:** \`${cmd.test}\`` : null,
    cmd.run ? `- **Run:** \`${cmd.run}\`` : null,
    cmd.lint ? `- **Lint:** \`${cmd.lint}\`` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const commandsSection = commandRows || "_(none detected — ask the user)_";
  const issuesSection = p.knownIssues.length
    ? p.knownIssues.map((i) => `- ${i}`).join("\n")
    : "_(none known)_";
  const productLink = p.prdPath
    ? `Product context (goals, users, features, success metrics): see [${p.prdPath}](${p.prdPath}).`
    : "Product context: no PRD found.";

  return `# AGENTS.md — ${p.projectName}

Guide for coding agents working in this repository. ${productLink}

## Summary
${p.summary}

## Tech Stack
${p.techStack}

## Project Structure
${p.structure}

## Commands
${commandsSection}

## Conventions
${p.conventions}

## Boundaries (technical)
${p.boundaries}

## Known Issues & Gotchas
${issuesSection}

## Companion Extensions
${p.integration}

## Current Focus
${p.currentFocus}
`;
}

/**
 * A thin CLAUDE.md that points Claude Code at AGENTS.md as the single source of truth.
 * The `@AGENTS.md` line triggers Claude Code's file-import so the content is pulled in.
 */
export function claudeMdTemplate(projectName: string): string {
  return `# CLAUDE.md — ${projectName}

Guidance for Claude Code in this repository.

All project conventions, architecture, build/test commands, and boundaries live in
**[AGENTS.md](./AGENTS.md)** — the shared guide for every coding agent. Keep that file
as the single source of truth; do not duplicate its content here.

@AGENTS.md
`;
}
