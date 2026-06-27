# Build Prompt: `@aprimediet/codewalker` v1.1 — Queryable Code Index (TDD)

> **How to use this file:** Hand this entire document to a coding agent working in the
> `pi-harnes` repo. It is a complete, self-contained brief. You build the v1.1 **code-index**
> layer of codewalker **strictly test-first (red → green → refactor)**. Read the referenced
> sibling extensions, then write each test before its implementation. Verify against §13.

---

## 1. Role & Goal

Extend the **pi coding-agent** extension **`@aprimediet/codewalker`** with a **queryable code
index** so the agent stops blindly scanning files. Instead of `glob`→`grep`→`read` across the
repo (which floods the context window with mostly-irrelevant bytes on every request), the agent
issues a query and gets back **a few exact facts** — symbol name, kind, `file:line`, and a
one-line summary — and reads only the precise spans it actually needs.

**The north star is token economy.** Pay the file scan **once, out of band** (a mechanical
ctags/regex pass that never enters the LLM context) and query it **cheaply, many times**. The
design rationale lives in `extensions/codewalker/docs/claude-suggestion.md` (esp. §0.5, §0.6)
and `docs/tech-decision.md` — read both before starting.

### v1.1 scope (build exactly this — no more)
- Mechanical symbol extraction: **ctags primary + regex fallback** (TS/JS/Py/Go).
- **SQLite + FTS5** index (`better-sqlite3`) derived from the symbols and from markdown cards.
- **Markdown cards** (head/body) as the source of truth, written to the global pi dir.
- Commands: `/codewalker scan` (full build — first run creates the index, re-running rebuilds it),
  `/codewalker sync` (git-anchored incremental), `/codewalker query`. No separate `reindex`.
- An LLM-callable tool `codewalker_query` (compact results).
- **git-anchored** incremental sync + per-query staleness signal.
- A `codewalker` skill telling the agent when/how to query before editing.

### Explicitly OUT of scope for v1.1 (do NOT build)
- No LLM/agentic semantic enrichment (Tier 3 summaries).
- No library extraction from `node_modules` (that is v1.2).
- No coverage/quality analyzer (v1.4).
- No `/learn-this` command — v1.1 is a clean standalone code-index; do not build or restore it.

---

## 2. Output Directory

```
/home/aditya/workspaces/researches/pi-harnes/extensions/codewalker/
```

Currently contains only `docs/`, `.pi/`, `.gitignore`, `.git`. Create all new source fresh.
This is a clean standalone build — do **not** restore the previous `/learn-this` implementation
from git history; v1.1 ships only the code-index layer.

---

## 3. Prerequisite Reading (do this before writing any code)

| File | Why |
|---|---|
| `extensions/codewalker/docs/claude-suggestion.md` | The design — §0.5/§0.6 (token economy, head/body cards), §2 (storage), §3 (schema), §4 (extraction tiers), §5 (git sync), §6 (query) |
| `extensions/codewalker/docs/tech-decision.md` | Why SQLite/FTS5, not vectors |
| `extensions/memory/project.ts` | **Copy this almost verbatim** — id algorithm, marker, `ProjectPaths`, `piHome()` |
| `extensions/memory/store.ts` | Card serialize/parse + atomic write idiom + `rebuildIndexFile` (MEMORY.md) pattern |
| `extensions/memory/index.ts` | `registerTool` (TypeBox), `registerCommand`, `ctx.ui.notify`, `AgentToolResult` return shape |
| `extensions/storage/src/db/bootstrap.ts` + `src/db/open.ts` | **Reference `better-sqlite3` + FTS5 bootstrap** (external-content virtual table) |
| `extensions/storage/src/query/keyword.ts` | Reference FTS5 `MATCH` + `bm25` query pattern |
| `extensions/storage/tsconfig.json` + `vitest.config.ts` | **Copy these** as the TS + test config |
| `docs/session-summary.md` | jiti runtime gotchas (factory export, `.ts` imports, no parameter properties) |

**Critical invariants**
1. The `.pi/<project-id>.md` marker and id algorithm `slug(basename)-sha1(absRoot)[:8]` are
   **shared** with memory and minion. Reuse the existing marker (marker-wins); never create a
   second marker or corrupt the existing one.
2. Codewalker writes **only** under `~/.pi/projects/<id>/codewalker/`. The working repo stays
   clean — no `.codewalker/` folder, no index files committed.

---

## 4. Runtime & Tooling Constraints (jiti + vitest)

pi loads extensions as **TypeScript on Node ≥20 via jiti** (no build step). Obey:

- **Default export is a factory function**: `export default function codewalkerExtension(pi: ExtensionAPI): void { … }`.
- **Imports are relative with explicit `.ts`** extension at runtime (`import { x } from "./db.ts"`).
  The `@/*` alias works in tsc/vitest but **fails at runtime** — do not use it in shipped code.
- **No TS parameter properties** (`constructor(private x)`); use plain class fields.
- **Test runner is vitest** (`vitest run`). Tests live at `src/**/*.test.ts`. Test files may
  import without the `.ts` extension (Bundler resolution); runtime code may not.
- Copy `extensions/storage/tsconfig.json` and `vitest.config.ts` verbatim (adjust nothing except
  removing the `@/*` paths reliance in shipped code).

---

## 5. File Structure to Create

```
extensions/codewalker/
├── package.json            # v0.2.0; pi:{extensions,skills,prompts}; dep better-sqlite3 ^11
├── tsconfig.json           # copied from extensions/storage
├── vitest.config.ts        # copied from extensions/storage
├── index.ts                # factory: registers the codewalker_query tool + /codewalker command
├── src/
│   ├── project.ts          # copied from memory/project.ts, subdir memory/ → codewalker/
│   ├── types.ts            # Symbol, CardHead, QueryResult, IndexMeta interfaces
│   ├── extract/
│   │   ├── ctags.ts        # detect ctags on PATH + run --output-format=json (thin shell)
│   │   ├── ctags-parse.ts  # PURE: ctags json line → Symbol[]; kind mapping; skip malformed
│   │   ├── regex.ts        # PURE fallback: TS/JS/Py/Go source text → Symbol[]
│   │   └── docs.ts         # PURE: leading //, /** */, or docstring above a line → doc string
│   ├── cards.ts            # PURE: Symbol ↔ head/body markdown card; cardHead() compact projection
│   ├── db.ts               # better-sqlite3 open + bootstrap (files,symbols,symbols_fts,meta) + upsert/search
│   ├── git.ts              # getHeadSha(); PURE parse of `git diff --name-only`
│   ├── indexer.ts          # full build + git-anchored sync (walk→extract→docs→cards→db→meta)
│   ├── query.ts            # search → ranked compact rows + getCard(id) + staleness note
│   └── format.ts           # PURE: token-bounded one-line-per-hit formatter
├── skills/
│   └── codewalker/SKILL.md  # when/how the agent queries BEFORE editing
├── prompts/
│   └── codewalker.md
└── README.md
```

---

## 6. `package.json`

```json
{
  "name": "@aprimediet/codewalker",
  "version": "0.2.0",
  "type": "module",
  "description": "Queryable, token-economical project & code index for the pi coding agent.",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./index.ts"],
    "skills": ["./skills"],
    "prompts": ["./prompts"]
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "files": ["*.ts", "src/**", "skills/**", "prompts/**", "README.md"],
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-agent-core": "*",
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-tui": "*",
    "typebox": "*"
  },
  "dependencies": { "better-sqlite3": "^11.0.0" },
  "devDependencies": { "vitest": "^1.6.0", "@types/better-sqlite3": "^7.6.0" },
  "engines": { "node": ">=20" },
  "publishConfig": { "access": "public" }
}
```

> Note `better-sqlite3` is a **required** dependency here (not optional like memory), because
> the index is core to v1.1. Exclude `src/**/*.test.ts` from the published `files` if desired.

---

## 7. Storage layout (mirror `memory`, project-scoped)

Copy `extensions/memory/project.ts`. Keep the id algorithm and marker logic **unchanged**.
Change only the per-extension subdir and the path helpers so `ProjectPaths` yields:

```
~/.pi/projects/<id>/codewalker/
├── index.db                       # SQLite + FTS5 (disposable, rebuildable)
├── meta.json                      # { schemaVersion, lastIndexedCommit, lastFullScan }
├── CODEWALKER.md                  # human-readable index/overview (≈ memory's MEMORY.md)
└── entries/
    └── symbols/<file-slug>/<symbol>.md
```

- `piHome()` = `path.dirname(getAgentDir())`; global dir = `path.join(piHome(), "projects", id, "codewalker")`.
- All writes are atomic via `withFileMutationQueue` + temp + `rename` (mode `0o600` for global data).
- The repo working tree receives **nothing** from this layer.

---

## 8. SQLite schema (`src/db.ts`)

Use `better-sqlite3`; enable `PRAGMA journal_mode=WAL`. Bootstrap is idempotent (`IF NOT EXISTS`).

```sql
PRAGMA user_version = 1;

CREATE TABLE IF NOT EXISTS files (
  path        TEXT PRIMARY KEY,
  lang        TEXT,
  blob_sha    TEXT,
  indexed_at  TEXT
);

CREATE TABLE IF NOT EXISTS symbols (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT,                -- function | const | class | type | method | enum
  file_path   TEXT,
  line_start  INTEGER,
  line_end    INTEGER,
  signature   TEXT,
  doc         TEXT,
  summary     TEXT,                -- reserved for v1.3; empty in v1.1
  card_path   TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(
  name, signature, doc, summary,
  content='symbols', content_rowid='id',
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
```

- Keep `symbols_fts` in sync by rewrite-on-reindex: when re-indexing a file, `DELETE` its
  `symbols` rows and the matching `symbols_fts` rows, then `INSERT` fresh. (External-content FTS5
  requires deleting the FTS row with the special `'delete'` command or rebuilding — follow the
  pattern in `extensions/storage/src/db/bootstrap.ts`.)
- Rank with `bm25(symbols_fts, 10.0, 5.0, 1.0, 8.0)` (name and summary weighted highest).
- `meta` keys: `last_indexed_commit`, `schema_version`, `last_full_scan`.

---

## 9. Card anatomy (`src/cards.ts`) — head/body for two audiences

A card's **frontmatter head** is the compact, agent-cheap projection (what `query` returns); the
**body** is human-rich (read only on explicit expand). One file serves both, so they can't drift.

```markdown
---
name: probeCompat
kind: function
signature: (cwd: string) => CompatResult
location: compat.ts:201-243
tags: [integration, minion, memory, detection]
summary: Detect whether minion & memory are active for the project at cwd.
---

# probeCompat

<body: doc comment + any later human notes. v1.1 fills this from the extracted doc comment.>
```

- `renderCard(symbol): string` — head frontmatter + `# name` + body (the doc text).
- `parseCard(text): { head: CardHead; body: string }` — inverse; round-trips the head fields.
- `cardHead(text): CardHead` — returns ONLY the frontmatter (the token-cheap view).

---

## 10. Query surfaces (`index.ts`)

Expose **both** — agent-facing tool and human-facing command.

### `codewalker_query` tool (TypeBox params; compact by default)
```ts
import { Type } from "typebox";

pi.registerTool({
  name: "codewalker_query",
  label: "Codewalker Query",
  description: "Search the project's code index for symbols (functions, consts, classes, types). " +
    "Returns compact facts (name, kind, file:line, one-line summary) — use this BEFORE grepping/reading files.",
  parameters: Type.Object({
    query: Type.String({ description: "Search text — symbol name or concept keywords." }),
    kind:  Type.Optional(Type.String({ description: "Filter: function|const|class|type|method|enum" })),
    limit: Type.Optional(Type.Number({ description: "Max hits (default 10)." })),
  }),
  async execute(_id, params, _signal, _onUpdate, ctx) {
    const { rows, staleness } = runQuery(ctx.cwd, params);   // from src/query.ts
    return {
      content: [{ type: "text", text: formatCompact(rows, staleness) }],  // ONLY this reaches the model
      details: { rows },                                                   // full rows: logs/UI, NOT sent
    };
  },
});
```

**The content/details split is the token lever**: the model receives only the compact text; the
full row objects stay in `details`. Never dump card bodies into `content`.

### `/codewalker` command (human)
`pi.registerCommand("codewalker", …)` with first-word subcommands parsed from `args`:
`scan` (full build — first run creates the index; re-running fully rebuilds it), `sync`
(git-anchored incremental), `query <text>`. There is **no separate `reindex` command** — `scan`
is the (re)build. Use `ctx.ui.notify` for progress; scan/sync run out-of-band (not in an agent turn).

---

## 11. Behaviors

- **Indexing is out-of-band.** `scan`/`sync` are driven by the command (or a CLI),
  never by the agent reading files mid-turn. The agent only ever calls `codewalker_query`.
- **`scan` is idempotent / always a full (re)build.** First run creates the index; re-running
  re-extracts everything, overwrites cards, and removes cards + rows for files that no longer exist.
  No state distinguishes "first scan" from "reindex" — `scan` handles both.
- **Extraction**: try ctags first (`ctags --output-format=json -f - --fields=+nKzS <files>`);
  if ctags is not on PATH, fall back to the regex extractor for `.ts/.tsx/.js/.jsx/.py/.go`.
  Log which path was used. After locating each symbol, pull its leading doc comment via `docs.ts`.
- **git-anchored sync**: store `meta.last_indexed_commit`. `sync` = `git diff --name-only
  <last_indexed_commit> HEAD` (plus `git status --porcelain` for uncommitted edits) → reindex only
  changed files, delete rows+cards for removed files, advance `last_indexed_commit`. Non-git repos
  fall back to per-file `blob_sha` (content hash) comparison.
- **Staleness signal**: every query result is tagged with `indexed @<short>; HEAD @<short>
  (<n> files changed — run /codewalker sync)` when they differ, so the agent knows when to trust.
- **Compact-by-default**: query returns top-N (default 10) one-line facts; full card only via
  `getCard(id)` / an explicit expand. A query must never be able to dump the repo into context.
- **Cards are the source of truth; the DB is derived.** `scan` writes cards first, then builds
  `index.db` by reading those cards (internal `rebuildDbFromCards()`). So the DB is always a
  derivative of the markdown — disposable and rebuildable from `entries/` alone, never the
  canonical store.

---

## 12. TDD — write the test FIRST, every time

**Mandatory discipline:** for each item below, (1) write the failing test, (2) run
`npx vitest run src/<file>.test.ts` and see it **red**, (3) implement the minimum to make it
**green**, (4) refactor. **No production code may be written before a failing test exists for it.**
Build in this dependency order:

1. **`project.test.ts`** — id = `slug(basename)-sha1(absRoot)[:8]`; an existing `.pi/<id>.md`
   marker's id is reused (marker-wins); `findProjectRoot` walks up to `.git`/`.pi`; paths resolve
   under `~/.pi/projects/<id>/codewalker/{index.db,meta.json,entries}`.
2. **`extract/ctags-parse.test.ts`** (PURE) — a ctags JSON line → `Symbol{name,kind,file_path,
   line_start,signature}`; kind mapping (`function`/`variable`→`const`/`class`/`member`→`method`/
   `enum`/`typedef`→`type`); malformed or non-tag lines skipped; missing `signature` tolerated.
3. **`extract/regex.test.ts`** (PURE) — TS/JS `function`, `export const`, `class`, `type`;
   Python `def`/`class`; Go `func`; returns correct 1-based line numbers; best-effort skip of
   matches inside comments/strings.
4. **`extract/docs.test.ts`** (PURE) — extracts a `//` comment block, a `/** JSDoc */`, and a
   Python docstring immediately above a given line; returns `""` when there is none.
5. **`cards.test.ts`** (PURE) — `renderCard(symbol)` emits head frontmatter + body; round-trip
   `parseCard(renderCard(s))` preserves all head fields; `cardHead()` returns only the head.
6. **`db.test.ts`** (integration, tmp file) — bootstrap creates `files`/`symbols`/`symbols_fts`/
   `meta`; inserting a symbol makes it findable via FTS `MATCH`; `bm25` orders a name hit above a
   doc-only hit; re-indexing a file (delete+insert) is idempotent (no dupes); `meta` get/set.
7. **`format.test.ts`** (PURE) — N rows → N compact lines `name  kind  file:line  summary`;
   long summaries truncated; output capped at `limit`; empty rows → a friendly "no matches" line;
   staleness note appended when present.
8. **`git.test.ts`** — PURE parse of `git diff --name-only` output → `string[]`; `getHeadSha` and
   `changedFilesSince` exercised in a tmp git repo; `commit === HEAD` → `[]`.
9. **`query.test.ts`** (integration) — over a seeded DB: a text query returns compact rows with
   `file:line`; `kind` filter narrows; `limit` defaults to 10; `getCard(id)` returns the full body
   (expand-on-demand); the result carries the staleness note when `last_indexed_commit` ≠ HEAD.
10. **`indexer.test.ts`** (integration, fixture repo) — a full `scan` writes cards under
    `entries/symbols/` and populates the DB; `meta.last_indexed_commit === HEAD`; **running `scan`
    twice is idempotent** (no duplicate rows/cards) and a second scan removes cards + rows for a
    file deleted between runs; **`rebuildDbFromCards()` reproduces the DB from cards alone**
    (disposable-index property); with ctags mocked absent, the regex fallback still indexes TS/JS/Py/Go.
11. **`sync.test.ts`** (integration) — after editing one fixture file, `sync` reindexes only that
    file (others’ `indexed_at` unchanged); deleting a file removes its rows and card; the commit
    pointer advances.
12. **`index.contract.test.ts`** (smoke, fake `pi` stub) — the default export is a factory; calling
    it registers a tool named `codewalker_query` and a command named `codewalker`; invoking
    `tool.execute` returns `{ content: [text], details }` where `content` is compact and the full
    rows live in `details`.

Keep pure modules (parsers, cards, format, git-parse) free of I/O so their tests need no fixtures.

---

## 13. Verification Checklist

- [ ] `npm test` runs vitest; **all 12 test groups pass**; pure modules covered.
- [ ] `package.json` has `keywords:["pi-package"]`, the `pi` section, and `better-sqlite3` dep.
- [ ] `src/project.ts` matches memory's id algorithm; writes only to `~/.pi/projects/<id>/codewalker/`.
- [ ] No new files appear in the repo working tree (`git status` clean except intended README/docs).
- [ ] Extension loads: `pi -e ./extensions/codewalker/index.ts` (no errors).
- [ ] `/codewalker scan` creates `~/.pi/projects/<id>/codewalker/index.db` + cards; `meta.json` has `last_indexed_commit`.
- [ ] `/codewalker query "<term>"` returns compact `name · kind · file:line · summary` hits.
- [ ] Edit a file, `/codewalker sync` → only that file re-indexed; query reflects the change.
- [ ] Re-running `/codewalker scan` is idempotent (no duplicate rows/cards); `rebuildDbFromCards()` reproduces `index.db` from cards alone.
- [ ] The agent can call the `codewalker_query` tool and receives compact `content` (full rows only in `details`).
- [ ] ctags-absent path verified (rename/hide ctags, confirm regex fallback indexes TS/JS/Py/Go).

### Quick test
```bash
cd /home/aditya/workspaces/researches/pi-harnes/extensions/codewalker
npm install
npm test                      # red→green TDD suite
pi -e ./index.ts              # load; then run /codewalker scan, /codewalker query "<term>", /codewalker sync
```
