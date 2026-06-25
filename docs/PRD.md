# Product Requirements Document: @aprimediet/codewalker

**Version:** 1.0
**Date:** 2026-06-25
**Status:** Draft

## Overview
Project intelligence extension for the pi coding agent that systematically analyzes any project — tech stack, goals, boundaries, status, technical issues — and produces structured documentation: a **PRD** for humans and **AGENTS.md** / **CLAUDE.md** for coding agents.

## Problem Statement
Developers using the pi coding agent need a fast, reliable way to understand a project they're working on without manually reading every file. The coding agent also needs structured project instructions to work effectively. Currently there's no automated way to generate this intelligence snapshot and split the content by audience (human vs. agent).

## Goals
- Identify tech stack (language, frameworks, infrastructure, package manager)
- Identify project goals and non-goals (interactively when missing)
- Identify boundaries, scope, and constraints of a project
- Generate a human-readable PRD.md with product context
- Generate an engineering-focused AGENTS.md for coding agents
- Detect companion extensions (minion, memory) and report their state
- Store the intelligence snapshot to persistent memory for session continuity

## Non-Goals
- Give suggestions or recommendations on how to improve the project
- Try to solve or fix technical issues found during analysis
- Research how to solve technical issues — diagnose only, no solutions
- Modify project files beyond the documentation it generates

## Target Users
Developers who use the pi coding agent and need to quickly get up to speed on a project or generate structured documentation for human and agent consumption.

## Key Features

### Tech Stack Detection
Automatically scan manifest files (package.json, tsconfig.json, requirements.txt, go.mod, Cargo.toml, etc.) and framework configs to identify primary language, frameworks, infrastructure, and package manager.

### Goals & Non-Goals Gathering
Search README and docs for existing goals. If not found, interactively gather them from the user one question at a time — problem solved, primary users, key features, out-of-scope items, success metrics.

### Boundary Documentation
Identify key entry points, external services, exposed interfaces (APIs, CLI flags), and technical constraints (runtime version, env vars, OS requirements).

### Project Status Scanning
Read recent git commits, check for changelogs/roadmaps, scan for TODO/FIXME/HACK/BUG markers in source code.

### Technical Issue Detection
Detect missing tests, broken env files, invalid configs, and TypeScript strictness issues — report without trying to fix.

### Audience-Split Documentation
Generate three documents from the same intelligence, each targeted at its audience:
- **docs/PRD.md** (humans, product) — overview, problem, goals, users, features, success metrics
- **AGENTS.md** (coding agents, engineering) — tech stack, commands, conventions, technical boundaries, gotchas
- **CLAUDE.md** (Claude Code) — thin pointer that imports AGENTS.md

### Integration Detection
Detect active `@aprimediet/minion` and `@aprimediet/memory` extensions via shared `.pi/<id>.md` project marker. Report open tasks and memory entries without modifying any files.

### Memory Storage
Store the full project intelligence snapshot to `@aprimediet/memory` (scope: project) for persistent recall across sessions.

## Success Metrics
- User can read a summary of their current project in PRD.md without reading every file manually
- Coding agent can read specific project instructions in AGENTS.md to work effectively
- Pi coding agent can learn and store the latest project snapshot in memory for session continuity
- Documentation is correctly split by audience with no overlap

## Scope & Boundaries
- **Runtime:** Node.js with ESM modules (`"type": "module"`)
- **Peer dependency:** `@earendil-works/pi-coding-agent`
- **No third-party runtime dependencies** — Node built-ins only (`fs`, `path`, `child_process`)
- **Exposed interface:** single `/learn-this` command registered with the pi extension API
- **File system operations:** all detection probes are read-only; writes are confined to documentation files (PRD.md, AGENTS.md, CLAUDE.md) and memory storage
- **Not a CI tool:** runs on-demand via `/learn-this`, not as a background service

## Open Questions
- Should AGENTS.md be auto-generated or user-edited after generation?
- How often should memory snapshots be refreshed — on every `/learn-this` run or on demand?
- Should the extension support non-Node.js projects (Python, Go, Rust) for full PRD/AGENTS.md generation?
- Should there be a flag to skip interactive questions when running in non-interactive mode?
