---
name: learn-this
description: Use when the user runs /learn-this or asks to analyze, understand, or get up to speed on the current project. Guides systematic project intelligence gathering across tech stack, goals, status, technical issues, PRD management, and integration detection.
---

# Learn This — Project Intelligence

Build a complete project intelligence snapshot for the current working directory.
Create a task for each phase listed below before starting any of them.

---

## Phase 1 — Tech Stack

Read the following files if they exist and record what you find:

| File | Signals |
|---|---|
| `package.json` | Node.js / JS / TS; read `dependencies` + `devDependencies` for frameworks |
| `tsconfig.json` | TypeScript |
| `bun.lock` / `pnpm-lock.yaml` / `yarn.lock` / `package-lock.json` | Package manager |
| `requirements.txt` / `pyproject.toml` | Python |
| `go.mod` | Go |
| `Cargo.toml` | Rust |
| `pom.xml` / `build.gradle` / `build.gradle.kts` | Java / Kotlin |
| `Gemfile` | Ruby |
| `next.config.*` / `vite.config.*` / `nuxt.config.*` / `astro.config.*` | Frontend framework |
| `tailwind.config.*` | Tailwind CSS |
| `Dockerfile` / `docker-compose.yml` | Docker |
| `.github/workflows/` | GitHub Actions |
| `.gitlab-ci.yml` | GitLab CI |

Also read `package.json` deps for: `react`, `vue`, `express`, `fastify`, `hono`,
`@nestjs/core`, `prisma`, `@prisma/client`, `drizzle-orm`, `@trpc/server`.

Record: primary language(s), frameworks, infrastructure, package manager.

---

## Phase 2 — Goals & Non-Goals

Search in order:
1. `README.md` — look for Goals, Non-Goals, About, Overview headings
2. `docs/PRD.md`, `docs/prd.md`, `PRD.md`, `.pi/prd.md`, `PRODUCT.md`, `SPEC.md`
3. Any markdown file whose name contains "goals" or "requirements"

**If goals are NOT found**, gather them interactively — ask ONE question at a time and wait
for the user's answer before asking the next:

1. "What problem does this project solve?"
2. "Who is the primary user or audience?"
3. "What are the 3 most important features?"
4. "What is explicitly out of scope?"
5. "What does success look like for this project?"

**Do NOT present all five questions at once. Ask one. Wait for the answer. Ask the next.**

---

## Phase 3 — Boundaries

From README and code structure, identify:
- Key entry points (main files, API routes, CLI commands)
- External services consumed (databases, third-party APIs, cloud services)
- Exposed interfaces (HTTP endpoints, CLI flags, exported packages)
- Technical constraints (runtime version, OS requirements, required env vars)

---

## Phase 4 — Project Status

1. Run: `git log --oneline -20` — record the output
2. Check for `CHANGELOG.md`, `TODO.md`, `ISSUES.md`, `ROADMAP.md`
3. Scan for technical debt markers:
   ```
   grep -r "TODO:\|FIXME:\|HACK:\|BUG:" --include="*.ts" --include="*.js" --include="*.py" --include="*.go" . 2>/dev/null | head -20
   ```

---

## Phase 5 — Technical Issues

Detect and report:
- No test directory or test config found (`test/`, `tests/`, `__tests__/`, `vitest.config.*`, `jest.config.*`)
- `.env.example` exists but `.env` is missing
- `tsconfig.json` is not valid JSON
- Count of `// @ts-nocheck` or `// @ts-ignore` occurrences

Then ask the user:
> "I found [N] potential issues above. Are there additional technical issues you want me to be aware of or address?"

Record their response.

---

## Phase 6 — Documentation Generation

Produce two complementary documents from everything gathered so far, and split the content
by audience. **Never put the same content in both.**

| Document | Audience | Holds the *what & why* / *how* |
|---|---|---|
| `docs/PRD.md` | Humans (product) | overview, problem, goals, non-goals, target users, key features, success metrics, product-scope boundaries, open questions |
| `AGENTS.md` (repo root) | Coding agents (engineering) | tech stack, project structure, build/test/run commands, conventions, **technical** boundaries, known issues, companion-extension usage, current focus |
| `CLAUDE.md` (repo root) | Claude Code | thin pointer that imports `AGENTS.md` |

### 6a — PRD (human, product)

**Search for existing PRD** in: `docs/PRD.md`, `docs/prd.md`, `PRD.md`, `.pi/prd.md`,
`PRODUCT.md`, `SPEC.md`, or `README.md` with a Goals/Requirements heading.

**If it exists**: read and summarize key sections for the Phase 8 summary.

**If it does NOT exist**:
- Ask: "No PRD found. Should I create `docs/PRD.md` with the product information we gathered?"
- If yes, write `docs/PRD.md` using this template (product content only — no commands, no file paths, no conventions):

```
# Product Requirements Document: <project-name>

**Version:** 1.0
**Date:** <today>
**Status:** Draft

## Overview
<1-2 sentence vision summary>

## Problem Statement
<what problem this solves and who has it>

## Goals
- <goal from Phase 2>

## Non-Goals
- <non-goal from Phase 2>

## Target Users
<from Phase 2>

## Key Features
### <Feature>
<product-level description>

## Success Metrics
- <metric from Phase 2>

## Scope & Boundaries
<product-scope boundaries from Phase 3 — what the product will and will not do>

## Open Questions
- <any unresolved questions>
```

### 6b — AGENTS.md (coding agent, engineering)

**Search for an existing agent guide** at: `AGENTS.md`, `.agents/AGENTS.md`, `docs/AGENTS.md`.

**If it exists**: read it; offer to update stale sections rather than overwrite.

**If it does NOT exist**:
- Ask: "No AGENTS.md found. Should I create one at the repo root for coding agents?"
- If yes, write `AGENTS.md` using this template (engineering content only — NO product goals/users/metrics; link to the PRD for those):

```
# AGENTS.md — <project-name>

Guide for coding agents working in this repository. Product context (goals, users,
features, success metrics): see [docs/PRD.md](docs/PRD.md).

## Summary
<one-line: what this codebase is, technically>

## Tech Stack
<languages, frameworks, infrastructure, package manager — from Phase 1>

## Project Structure
<key entry points and directories — from Phase 3>

## Commands
- **Setup:** <install command, if any>
- **Build:** <build command, if any>
- **Test:** <test command, if any>
- **Run:** <run/dev command, if any>
- **Lint:** <lint/format command, if any>

## Conventions
<code style, naming, patterns observed in the codebase — match what exists>

## Boundaries (technical)
<do-not-touch areas, invariants, generated files, things that must not change — from Phase 3>

## Known Issues & Gotchas
- <technical issue from Phase 5>

## Companion Extensions
<if minion/memory are active (Phase 7): how the agent should use them — e.g. check the
kanban board before starting, record durable facts to memory. If not active, say so.>

## Current Focus
<what is being worked on now — from Phase 4 recent commits / status>
```

### 6c — CLAUDE.md (Claude Code pointer)

**If `CLAUDE.md` does not already exist** at the repo root, create it as a thin pointer so
Claude Code loads the same guide (do not duplicate AGENTS.md content):

```
# CLAUDE.md — <project-name>

Guidance for Claude Code in this repository.

All project conventions, architecture, build/test commands, and boundaries live in
**[AGENTS.md](./AGENTS.md)** — the shared guide for every coding agent. Keep that file
as the single source of truth; do not duplicate its content here.

@AGENTS.md
```

If `CLAUDE.md` already exists with its own content, do NOT overwrite it — instead offer to
add the `@AGENTS.md` import line if it is missing.

---

## Phase 7 — Integration Detection

**Detect `@aprimediet/minion`:**

Step-by-step marker detection:
1. List all `*.md` files inside the `.pi/` directory at the project root
2. For each file, read its contents
3. Check if the file contains both `pi-project: true` and an `id:` field (in YAML frontmatter)
4. If found, extract the value after `id:` — this is the project id

Then check for minion:
- Check if `~/.pi/projects/<id>/tasks/` directory exists
- If yes: read each `*.md` file in the tasks dir; count those whose frontmatter has `status:` set to one of: `backlog`, `todo`, `in_progress`, `blocked`, `review`
- Report: count of open tasks + their titles + statuses

**Detect `@aprimediet/memory`:**

- Use the **same `.pi/<id>.md` marker** (one file serves both extensions — do not create a new one)
- Check if `~/.pi/projects/<id>/memory/` directory exists
- If yes: check for `~/.pi/projects/<id>/memory/MEMORY.md` — read it if present
- Count `*.md` files in `~/.pi/projects/<id>/memory/entries/`
- Report: active/not-detected, entry count, MEMORY.md contents

---

## Phase 8 — Compile Summary

Assemble the full project intelligence document using these exact section headers:

```
# Project Intelligence: <project-name>
> Generated by /learn-this on <date>

## Tech Stack
**Language(s):** ...
**Frameworks:** ...
**Infrastructure:** ...
**Package Manager:** ...

## Goals
...

## Non-Goals
...

## Boundaries
...

## Current Status
**Recent commits:**
<git log output>

**Open TODOs/FIXMEs:** N found

## Technical Issues
- ...

## Documentation
**PRD (`docs/PRD.md`):** exists | created | not created
**AGENTS.md:** exists | created | not created
**CLAUDE.md:** exists | created | not created
**Key points:** ...

## Minion Integration
**Status:** active | not detected
**Project ID:** ...
**Open tasks (N):**
- ...

## Memory Integration
**Status:** active (N entries) | not detected
**Index:**
<MEMORY.md contents, or "(empty)">
```

---

## Phase 9 — Store to Memory

**If `@aprimediet/memory` is active** (detected in Phase 7):
- Call `memory_write` with `scope: "project"`, `type: "fact"`, and `text:` set to the full Phase 8 summary
- Report: "Summary stored to project memory."

**If memory is not active**:
- Display the summary in chat
- Ask: "Would you like me to save this to `docs/project-intelligence.md`?"
- If yes, write the file.

---

## Checklist

- [ ] Phase 1: Tech stack identified
- [ ] Phase 2: Goals/non-goals found or gathered interactively (one question at a time)
- [ ] Phase 3: Boundaries documented
- [ ] Phase 4: Project status from git log + TODO scan
- [ ] Phase 5: Technical issues detected + user asked about additional issues
- [ ] Phase 6: Docs generated — PRD (product), AGENTS.md (engineering), CLAUDE.md (pointer), with user confirmation and audience-correct content split
- [ ] Phase 7: minion compatibility detected; memory compatibility detected
- [ ] Phase 8: Full summary compiled
- [ ] Phase 9: Summary stored to memory or saved to file
