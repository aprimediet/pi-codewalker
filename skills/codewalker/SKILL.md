---
name: codewalker
description: >
  Queryable code index + knowledge base for understanding codebases. Finds symbol
  definitions, function summaries, const/class/type/interface lookups, library API
  searches, glossary terms, and design decisions — before blindly grepping or reading
  files. Use FIRST when exploring unfamiliar code.
---

# Codewalker — Queryable Code Index + Knowledge Base

**Use this skill when:** you need to understand a codebase — find where a symbol is defined,
understand what a function does, check if a const/class/type/interface exists, search
library APIs, look up glossary terms or past design decisions — **before** blindly
grepping or reading files.

Codewalker is a token-economical project index that surfaces compact facts instead of
pulling whole files into your LLM context.

---

## Tools (agent-facing)

### `codewalker_query` — Search the index

Use this **first** before reading or grepping files. Returns one-line-per-hit:  
`name · kind · file:line · one-line-summary`

Parameters:
- `query` — symbol name or concept keywords
- `kind` — optional filter: `function|const|class|type|method|enum|interface|glossary|decision`
- `limit` — max hits (default 10)
- `source` — scope: `code` (default, source symbols), `libs` (library APIs), `notes` (glossary + decisions), `all` (everything)

### `codewalker_enrich` — Write a semantic summary

Call this **after** reading a symbol's source span. Caches a one-line (≤120 char)
plain-English summary so future queries surface meaning, not just names.

Parameters:
- `card` — `card_path` of the symbol (from the enrich worklist or query results)
- `summary` — one-line description of what it does

### `codewalker_note` — Save domain knowledge

Write a glossary term, design decision, or coding convention. Persists as a markdown
card + FTS index so future queries find it.

Parameters:
- `type` — `glossary` | `decision` | `convention`
- `title` — glossary term, decision title, or convention name
- `body` — definition, rationale, or convention description
- `tags` — optional comma-separated tags
- `related` — optional comma-separated symbol names or `file:line` refs

### `codewalker_finding` — Write an analysis finding

Write a coverage, debt, or best-practice finding. Persists as a markdown card under
`entries/analysis/<kind>/` + FTS index. Called by the agent during a review pass.

Parameters:
- `kind` — `coverage` | `debt` | `practice`
- `title` — short finding label
- `file` — optional file or `file:line` the finding is about
- `severity` — `info` | `warn` | `high` (default `info`)
- `body` — finding detail + why it matters, grounded in conventions/decisions
- `metric` — optional metric string, e.g. `'42%'`, `'fn length 180'`
- `related` — optional comma-separated symbol names or `file:line` refs

---

## Commands (human-facing)

| Command | Purpose |
|---------|---------|
| `/codewalker scan` | Full (re)build of the code index from scratch |
| `/codewalker sync` | Git-anchored incremental update (fast) |
| `/codewalker query <text>` | Search code symbols by name or keyword |
| `/codewalker enrich <path> [--max=N]` | List unenriched symbols under `path` for annotation |
| `/codewalker analyze [path]` | Mechanical coverage + debt analysis (reads lcov.info if present) |
| `/codewalker review <path> [--max=N]` | Agent-driven best-practice review against conventions (capped 25 files) |
| `/codewalker findings [query] [--kind=KIND]` | Search analysis findings |
| `/codewalker conventions [query]` | Search coding conventions |
| `/codewalker glossary [query]` | Search glossary terms |
| `/codewalker decisions [query]` | Search decision notes |
| `/codewalker libs [--dev]` | Index all direct npm dependencies (--dev includes devDeps) |
| `/codewalker lib <pkg> [query]` | Search a specific library's exported API symbols |
| `/codewalker help` | Show this help |

---

## Workflow

### 1. Before editing unfamiliar code
```
/codewalker query "<symbol-name>"
```
Or call `codewalker_query` directly from agent conversation.  
If hits are relevant, use the `file:line` to read only the span you need.

### 2. If the index is stale
Results include a staleness warning like:  
`⚠ Index is stale (3 file(s) changed since last index): indexed @abc1234, HEAD @def5678`  
→ Run `/codewalker sync` first, then query again.

### 3. First time in a project
```
/codewalker scan
```
This does a full build (ctags primary, regex fallback) and sets up the SQLite+FTS5 database.

### 4. Annotating symbols for future clarity
After reading a symbol you didn't understand, call `codewalker_enrich` with a summary.  
This builds up the codebase knowledge map over time.

### 5. Capturing domain knowledge
When you discover a project-specific concept or learn why a decision was made:
```
codewalker_note(type="glossary", title="term", body="definition")
codewalker_note(type="decision", title="why X", body="rationale")
```
These become searchable via `codewalker_query` with `source='notes'` or `source='all'`.

### 6. Capturing coding conventions
When you learn a project-specific coding convention, record it so reviews can measure
against it:
```
codewalker_note(type="convention", title="Use functional components",
  body="All React components must be pure functions, not classes.")
```
Then search them with `/codewalker conventions [query]`.

### 7. Running a health snapshot
```
/codewalker analyze
```
This parses `coverage/lcov.info` (if present) and scans source files for
TODO/FIXME/HACK markers, `@ts-ignore`, oversized files, and long functions.
Results are queryable via `/codewalker findings [query]` or
`codewalker_query source='analysis'`.

### 8. Reviewing a subsystem against conventions
```
/codewalker review src/auth
```
This selects files under `src/auth` (capped at 25) and produces a worklist for the
agent to review each file against the project's conventions and decisions. The agent
calls `codewalker_finding` to write findings back.

### 9. Exploring library APIs
```
/codewalker libs            # index dependencies
/codewalker lib express     # search express exports
/codewalker lib lodash get  # search lodash for 'get'
```

---

## Why

The index is built out-of-band (mechanical ctags/regex pass) so you never pay the
file-scan cost inside the LLM context. Queries return compact, ranked facts — tens of
tokens instead of thousands. The note system (glossary + decisions) captures conceptual
knowledge your future self will thank you for.

---

## Details

- **Staleness detection**: every query result includes git-anchored staleness info
  comparing the indexed commit against HEAD
- **FTS5 ranking**: results use bm25 relevance scoring; `code` → `libs` → `notes` order
  when using `source='all'`
- **Cards as source of truth**: every symbol and note is stored as a markdown card file.
  The DB is rebuilt from cards on `scan` — cards are the durable artifact
- **Source filter**: use `source='libs'` to search only library APIs, `source='notes'`
  for glossary/decisions, `source='analysis'` for findings, `source='all'` for everything
  at once
- **Report, don't gate**: analysis findings are advisory cards and FTS rows, never a CI
  gate or build failure
