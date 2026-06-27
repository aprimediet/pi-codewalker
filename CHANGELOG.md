# Changelog

## [1.1.0] — 2026-06-28

### Added

- **Queryable code index** — `codewalker_query` tool + `/codewalker query` command.
  Compact, ranked FTS5 results: `name · kind · file:line · summary`. Never dumps
  the repo into the LLM context.

- **Symbol extraction** — two-tier: **Universal Ctags** primary (JSON output, ~40
  languages) + **regex fallback** for TS/JS/Py/Go when ctags is absent.

- **SQLite + FTS5 index** (`better-sqlite3`) with BM25 ranking, WAL mode, and
  column weights (name/summary boosted over doc). External-content FTS5 virtual
  table synced via rewrite-on-reindex.

- **Git-anchored incremental sync** — `/codewalker sync` reindexes only files
  changed since `last_indexed_commit` via `git diff --name-only`. Per-query
  staleness signal when HEAD differs from the indexed commit.

- **Markdown cards as source of truth** — head/body anatomy. `renderCard()` /
  `parseCard()` / `cardHead()` with frontmatter (agent-cheap) + narrative body
  (human-rich). DB is disposable and rebuildable from cards via
  `rebuildDbFromCards()`.

- **Extraction commands**: `/codewalker scan` (full rebuild, idempotent),
  `/codewalker sync` (git-anchored incremental).

- **Doc comment extraction** — JSDoc (`/** … */`), line comments (`//`), and
  Python docstrings (`"""…"""`) pulled from lines above each symbol.

- **Agent skill** (`skills/codewalker/SKILL.md`) — teaches the agent to query
  the index BEFORE editing or grepping files.

- **System prompt** (`prompts/codewalker.md`) — injected prompt guiding the
  model to use `codewalker_query` as its first step.

- **Token-economical formatter** — `formatCompact()` produces one-line-per-hit
  output with truncated summaries. Staleness warning appended when the index
  is outdated.

- **86 automated tests** across 12 test files covering all layers (project
  identity, extraction, cards, DB, format, git, query, indexer, sync, contract).

### Changed

- **Architecture rewrite** — from v1.0 `/learn-this` project-knowledge snapshot
  to a full queryable code index (18 source files, 7 in `src/extract/`).
- **Package re-scoped** — from `@aprimediet/codewalker` v0.2.0 → v1.1.0.
- **Removed** — legacy `agents.ts`, `compat.ts`, `detect.ts`, `prd.ts`,
  `AGENTS.md`, `CLAUDE.md`, old root `index.ts`, `docs/PRD.md`,
  `skills/learn-this/SKILL.md` (all replaced by v1.1 architecture).
- `README.md` updated to reflect new architecture.

### Fixed

- `better-sqlite3` native binding now properly built (node-gyp rebuild).
- FTS5 tokenizer syntax corrected (quoted arguments).
- Path normalization: all file paths stored as absolute paths in DB,
  avoiding mismatch between git-relative and absolute paths during sync.

## [1.0.0] — 2026-06-25

### Added

- Initial release — `/learn-this` project-knowledge snapshot extension.
- Project detection via `.pi/<id>.md` marker (shared with memory/minion).
- Tech-stack detection (`detectTechStack`, `probeCompat`).
- Skill: `skills/learn-this/SKILL.md`.
- Published to npm as `@aprimediet/codewalker@1.0.0`.
