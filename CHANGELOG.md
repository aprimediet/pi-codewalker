# Changelog

## [1.2.0] — 2026-06-28

### Added

- **Library Knowledge Layer** — index and search library API symbols from
  `node_modules` .d.ts files. New tables `libraries`, `lib_symbols`, and
  `lib_symbols_fts` alongside existing v1.1 schema (additive, idempotent).

- **`.d.ts` export extraction** — `src/libs/dts.ts` extracts 7 common
  declaration forms (function, const, class, interface, type alias, enum,
  namespace) plus re-exports and default exports. Full unit test coverage.

- **Dependency discovery** — `src/libs/resolve.ts` parses `package.json`
  `dependencies`/`devDependencies`, resolves type entry points via
  `types`/`typings`/`exports` fields, and locates the corresponding
  `node_modules/<pkg>` directory.

- **Library indexing** — `src/libs/indexer.ts` orchestrates dependency
  resolution → `.d.ts` extraction → DB upsert. Invoked via
  `/codewalker libs [--dev]` command.

- **Version-pinned library cards** — lib symbols stored under
  `entries/libs/<pkg>@<version>/` mirroring the code symbol card pattern.

- **Unified query with source filter** — `codewalker_query` tool now accepts
  `source` parameter (`code` | `libs` | `all`). `/codewalker lib <pkg> [query]`
  searches a specific library's API symbols.

- **FTS5 external-content triggers** — triggers (`_ai`, `_ad`, `_au`) on
  both `symbols` and `lib_symbols` keep FTS indexes in sync automatically.
  Manual FTS maintenance removed, eliminating the "database disk image is
  malformed" corruption vector.

- **165 automated tests** across 16 test files (8 new lib test files).

### Changed

- `bootstrapDb()` user_version 1 → 2 (library schema upgrade).
- `upsertSymbol()` simplified — plain INSERT only; FTS sync handled by trigger.
- `deleteFileSymbols()` simplified — no direct FTS manipulation.
- Query formatter now handles lib-origin rows with `[pkg@version]` prefix.
- `ProjectPaths` gains `libsDir` field.
- `package.json` version 1.1.0 → 1.2.0.

### Security

- **Breaking change**: database re-index required — existing v1 databases
  lack the library tables. Run `/codewalker scan` after upgrading.

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
