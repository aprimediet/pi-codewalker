# AGENTS.md — @aprimediet/codewalker

Guide for coding agents working in this repository. Product context (goals, users, features, success metrics): see [docs/PRD.md](docs/PRD.md).

## Summary
Pi extension that systematically analyzes any project — tech stack, goals, boundaries, status, technical issues — and generates structured PRD (humans) + AGENTS.md/CLAUDE.md (coding agents).

## Tech Stack
**Language:** TypeScript (Node.js, ESM — `"type": "module"`)
**Frameworks:** None (pure pi extension)
**Infrastructure:** None
**Package Manager:** None (peer-only dependency on `@earendil-works/pi-coding-agent`; no lock file)

## Project Structure
```
codewalker/
├── index.ts          # Extension factory — registers /learn-this command
├── compat.ts         # Minion + memory integration detection
├── detect.ts         # File-based detection (tech stack, status, issues)
├── prd.ts            # PRD search, read, and generation (human docs)
├── agents.ts         # AGENTS.md + CLAUDE.md search and generation (agent docs)
├── docs/
│   └── PRD.md        # Product Requirements Document (human)
├── skills/
│   └── learn-this/
│       └── SKILL.md  # 9-phase intelligence gathering workflow + checklist
├── .pi/
│   └── codewalker-93b002d3.md  # Project marker (managed by pi, do not modify)
└── package.json      # Pi manifest: extensions + skills
```

## Commands
- **Setup:** `pi install npm:@aprimediet/codewalker` (or clone repo; no install needed for development since deps are bundled by pi)
- **Build:** None (TypeScript is executed directly by pi's runtime)
- **Test:** None (no test framework configured — `test/` directory not present)
- **Run (development):** `pi -e ./index.ts` — loads the extension directly from source
- **Lint:** None configured

## Conventions
- **ESM Modules** — all imports use the `node:` prefix for built-ins (`node:fs`, `node:path`, `node:child_process`)
- **Functions over classes** — utility functions, no classes
- **No external runtime dependencies** — stick to Node.js built-ins only (`fs`, `path`, `child_process`)
- **Read-only detection** — all probes check file existence or read files; never create/modify files outside the documented outputs (docs, AGENTS.md, CLAUDE.md)
- **Follow pi extension patterns** — use `ExtensionAPI.registerCommand()`, return `void` from handler, use `ctx.cwd` for root
- **Split by audience** — product content (goals, users, features, metrics) goes in PRD; engineering content (tech stack, commands, conventions) goes in AGENTS.md. Never duplicate.

## Boundaries (technical)
- **Do NOT modify** `.pi/codewalker-93b002d3.md` — the project marker is managed by pi/minion/memory
- **Do NOT modify** files outside: `docs/PRD.md`, `AGENTS.md`, `CLAUDE.md` — these are the only write targets
- **Do NOT add** third-party runtime dependencies — zero-runtime-dep constraint is a design invariant
- **Do NOT make network calls** — all detection is file-system-local
- **Read-only probes** — compat.ts, detect.ts must never write, create, or delete files or directories

## Known Issues & Gotchas
- No test directory or test config detected (add one before making non-trivial changes)
- No `tsconfig.json` in the repo — TypeScript compilation is handled by pi's runtime; no type-checking step exists in the workflow
- No git commits yet — the repo is initialized but has no history; `git log` returns an error in Phase 4, gracefully handled
- `detect.ts` runs `grep -c` which counts lines matching TODO/FIXME/HACK/BUG; false positives can occur if the pattern string itself contains these keywords (like detect.ts does)

## Companion Extensions
Both `@aprimediet/minion` and `@aprimediet/memory` are **active** for this project.

- **Minion:** project `codewalker-93b002d3`, 0 open tasks
- **Memory:** active (2 entries — one PRD progress, one project intelligence fact)

Before starting work, check the kanban board at `~/.pi/projects/codewalker-93b002d3/tasks/` for pending tasks. Record durable facts and progress to memory using `memory_write` with `scope: "project"`.

## Current Focus
Initial implementation — all 9 phases are implemented and the learn-this skill is complete. No open tasks or active development branches.
