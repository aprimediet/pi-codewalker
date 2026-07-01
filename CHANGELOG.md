# Changelog

## [1.4.1] — 2026-07-02

### Fixed

- **`prompts/codewalker.md` restored** — the system prompt file was accidentally deleted
  and is now restored to HEAD.

## [1.4.0] — 2026-06-28

### Added

- **Analysis layer (Tier 4)** — mechanical coverage + debt scanning + agent-driven
  best-practice review. Queryable analysis findings alongside code symbols, library
  APIs, glossary terms, and decision notes.

- **`analysis` table + `analysis_fts`** — new DB tables (v1.4 schema, user_version 4)
  with `analysis_ai`/`_ad`/`_au` triggers mirroring the existing `notes_*` trio.
  FTS sync is trigger-only.

- **Coverage parser** (`src/analyze/coverage.ts`) — pure function that parses
  `coverage/lcov.info` and `coverage-final.json` artifacts. Never runs a coverage
  tool. Severity banding: `<50%` → high, `50-80%` → warn, `>=80%` → info.

- **Debt scanner** (`src/analyze/debt.ts`) — pure function that scans source
  files for `TODO`/`FIXME`/`HACK`/`XXX` markers, `@ts-ignore`/`@ts-nocheck` usage,
  oversized files (`>400` lines), and long functions (`>120` lines via existing
  symbol spans). Groups findings by marker type via `summarizeDebt()`.

- **Analysis cards** (`src/analyze/cards.ts`) — `renderAnalysisCard()` /
  `parseAnalysisCard()` for coverage, debt, and practice finding cards under
  `entries/analysis/<kind>/<slug>.md`.

- **Analysis orchestrator** (`src/analyze/analyzer.ts`) — `runAnalyze()` walks the
  project tree, parses coverage files, scans debt, writes cards, and upserts DB rows
  idempotently. `rebuildAnalysisDbFromCards()` reconstructs the DB from cards alone.

- **Review helpers** (`src/analyze/review.ts`) — `validateReviewPath()`,
  `checkReviewCap()` (default 25 files), `selectFilesForReview()`,
  `formatReviewWorklist()` that tells the agent to ground findings in
  conventions/decisions. Mirrors the enrich.ts guardrail pattern exactly.

- **`codewalker_finding` tool** — agent-callable: writes a coverage, debt, or
  practice finding (with severity, metric, file location, and body). Persists as
  a card under `entries/analysis/<kind>/` and an `analysis` DB row.

- **Convention notes** — `NoteKind` extended to `'convention'`;
  `codewalker_note type=convention` writes a convention card under
  `entries/conventions/`. Searched via `/codewalker conventions [query]`.

- **`/codewalker analyze [path]`** — mechanical analysis: reads coverage artifacts
  if present, scans debt markers. Reports counts. Never runs a coverage tool.

- **`/codewalker review <path>`** — lazy, scoped, capped agent-driven best-practice
  review. Refuses bare (no path) and over-cap selections.

- **`/codewalker findings [query]`** — search analysis findings with optional
  `--kind=coverage|debt|practice` filter.

- **`/codewalker conventions [query]`** — search coding conventions.

- **Unified query with analysis** — `codewalker_query` and `runQuery` now accept
  `source='analysis'`. `source='all'` interleaves code + lib + note + analysis
  rows ranked by bm25.

- **Finding-row formatting** — `formatCompact` renders analysis rows with
  `[coverage]`/`[debt]`/`[practice]` prefix + severity, one line per hit.

- **`ProjectPaths.analysisDir` / `ProjectPaths.conventionsDir`** — new path
  fields; `ensureProject` creates both directories.

- **Analysis FTS rebuilding** — `rebuildFtsIndexes()` now includes
  `analysis_fts` alongside symbols, lib_symbols, and notes FTS indexes.

- **`rebuildNotesDbFromCards()`** — now also processes convention cards.

- **Skill + prompt updates** — SKILL.md teaches analyze-for-health-snapshot,
  capture-conventions-first, review-against-conventions, and report-don't-gate.
  Prompt updated with analyze/review workflow.
- **295 automated tests** across 25 test files (5 new: analyze/{coverage,debt,
  cards,analyzer,review}; 9 extended).

### Changed

- `bootstrapDb()` user_version 3 → 4 (analysis schema upgrade).
- `NoteKind` type now includes `'convention'`.
- `QueryResultRow.source` now includes `'analysis'`.
- `parseNoteCard()` accepts `'convention'` note kind.
- `runQuery()` and `codewalker_query` now support `source='analysis'`.
- `formatCompact()` renders `[coverage]`/`[debt]`/`[practice]` finding rows.
- `ProjectPaths` gains `analysisDir` and `conventionsDir` fields.
- `package.json` version 1.3.0 → 1.4.0.

## [1.3.0] — 2026-06-28

### Added

- **Semantic enrichment (Tier 3)** — agent-driven, lazy, user-scoped.
  `codewalker_enrich` tool writes a one-line `summary` to a symbol's card
  and DB row. FTS reindexes via existing `symbols_au` trigger.

- **Bridge cards: glossary & decisions** — `codewalker_note` tool writes
  glossary terms and decision notes persisted as markdown cards under
  `entries/{glossary,decisions}/` and FTS-indexed via the new `notes` table.

- **`notes` table + `notes_fts`** — new DB tables (v1.3 schema, user_version
  3) with `notes_ai`/`_ad`/`_au` triggers mirroring the existing
  `symbols_*` trigger trio. FTS sync is trigger-only.

- **`codewalker_note` tool** — agent-callable: writes a glossary term
  (type=`glossary`) or decision note (type=`decision`) with title, body,
  optional tags, and related symbol refs.

- **`codewalker_enrich` tool** — agent-callable: writes a semantic summary
  back to a symbol's card file and `symbols.summary` column.

- **`/codewalker enrich <path>`** — selects unenriched symbols under a path
  prefix, enforces a cap (default 40, override with `--max=N`), and emits
  a worklist for the agent. Refuses bare `/codewalker enrich` (no path) and
  over-cap selections.

- **`/codewalker glossary [query]`** — search glossary terms via FTS.

- **`/codewalker decisions [query]`** — search decision notes via FTS.

- **Unified query** — `codewalker_query` and `runQuery` now accept
  `source: 'notes' | 'all'`. `source='all'` interleaves code + lib + note
  rows ranked by bm25.

- **Note-row formatting** — `formatCompact` renders note rows with
  `[glossary]` / `[decision]` prefix, one line per hit, summary truncated
  to 60 chars.

- **`updateCardSummary()`** — pure function in `cards.ts` that rewrites
  frontmatter `summary:` and upserts a `## What it does` body section.
  Idempotent: second apply replaces, doesn't stack.

- **`renderNoteCard()`** — pure function in `notes-cards.ts` that renders
  a glossary/decision card with frontmatter head (`note_kind`, `title`,
  `tags`, `related`, `summary`).

- **`rebuildNotesDbFromCards()`** — reconstructs `notes` table from card
  files (demonstrating the disposable-index property).

- **`ProjectPaths.glossaryDir` / `ProjectPaths.decisionsDir`** — new path
  fields; `ensureProject` creates both directories.

- **Enrichment guardrails** — `validateEnrichPath` rejects empty paths;
  `checkEnrichCap` enforces the 40-symbol default cap with clear error
  messages.

- **Skill + prompt updates** — SKILL.md teaches consult-before-editing,
  enrich-what-you-learn, and capture-decisions/terms rules. Source filter
  documented (source: code | libs | notes | all).
- **216 automated tests** across 19 test files (3 new: notes-cards, notes,
  enrich; 13 extended).

### Changed

- `bootstrapDb()` user_version 2 → 3 (notes schema upgrade).
- `runQuery()` and `codewalker_query` now support `source='notes' | 'all'`.
- `formatCompact()` renders `[glossary]`/`[decision]` prefixed note rows.
- `ProjectPaths` gains `glossaryDir` and `decisionsDir` fields.
- `package.json` version 1.2.0 → 1.3.0.

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
