# @aprimediet/codewalker

Systematic **project intelligence** for the [pi coding agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent): analyze tech stack, goals, boundaries, status, and technical issues, then generate a **PRD** for humans and **AGENTS.md** / **CLAUDE.md** for coding agents — plus integration with `@aprimediet/minion` and `@aprimediet/memory`.

Documentation is split by audience: `docs/PRD.md` holds the product *what & why* (overview, goals, users, features, metrics); `AGENTS.md` holds the engineering *how* (tech stack, structure, commands, conventions, technical boundaries, gotchas); `CLAUDE.md` is a thin pointer that imports `AGENTS.md` as the single source of truth.

## Phases

| Phase | What it does |
|-------|---|
| Phase 1 | Detect primary language, frameworks, infrastructure, and package manager from manifest files |
| Phase 2 | Find or gather project goals and non-goals (interactively, one question at a time) |
| Phase 3 | Document key entry points, external services, exposed interfaces, and technical constraints |
| Phase 4 | Scan recent commit history and search for technical debt markers (TODO/FIXME/HACK/BUG) |
| Phase 5 | Detect missing test directories, broken env files, invalid configs, and TypeScript strictness issues |
| Phase 6 | Generate docs, split by audience: `docs/PRD.md` (product), `AGENTS.md` (engineering), `CLAUDE.md` (pointer to AGENTS.md) — each with user confirmation |
| Phase 7 | Detect active `@aprimediet/minion` and `@aprimediet/memory` integrations via the shared `.pi/<id>.md` marker |
| Phase 8 | Compile full project intelligence document with all sections |
| Phase 9 | Store summary to memory (if active) or save to local file |

## Install

```bash
pi install npm:@aprimediet/codewalker
pi list
```

## Quick try

```bash
pi -e ./extensions/codewalker/index.ts
```

Then run `/learn-this` in any project.

## Integration

codewalker automatically detects the presence of two companion extensions via a shared project marker:

**Minion Integration (read-only):**
- Reads the `.pi/<project-id>.md` marker file from the current working directory
- Checks `~/.pi/projects/<id>/tasks/` for open kanban cards (backlog, todo, in_progress, blocked, review)
- Counts and reports open task count during the `/learn-this` summary

**Memory Integration (read-only + write):**
- Reads the same `.pi/<project-id>.md` marker file
- Checks `~/.pi/projects/<id>/memory/` for active memory (MEMORY.md + entries/)
- Counts memory entries and reads the index during Phase 7
- In Phase 9, if memory is active, calls `memory_write` with scope `"project"` to store the full intelligence snapshot

Both integrations use **read-only detection** (no creation of files or directories); the marker file is created and managed by minion or memory when activated. codewalker coexists with them seamlessly in the same `~/.pi/projects/<id>/` workspace.

## Layout

```
codewalker/                # @aprimediet/codewalker
├── package.json           # pi manifest: extensions + skills
├── index.ts               # extension factory: /learn-this command (probes + triggers the workflow)
├── compat.ts              # minion + memory integration detection
├── detect.ts              # phase-specific file and marker detection
├── prd.ts                 # PRD (human) search, read, and generation
├── agents.ts              # AGENTS.md + CLAUDE.md (agent) search and generation
└── skills/
    └── learn-this/
        └── SKILL.md       # 9-phase intelligence gathering workflow + checklist
```

The `/learn-this` command probes integration status, shows it, then sends a user message
that triggers the agent to invoke the `learn-this` skill and run all 9 phases.

No third-party runtime deps — only the pi-core packages (peer, bundled by pi).
