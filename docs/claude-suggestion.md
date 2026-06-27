# Codewalker — Design Suggestion: Queryable Project & Codebase Knowledge

> A pragmatic, low-infra design for turning codewalker into a queryable knowledge base
> for the pi coding agent. Storage primitives: **SQLite + FTS5** (for fast search) and
> **plain markdown cards** (the durable source of truth). No servers, no embeddings
> service, no vector DB.

---

## 0. TL;DR (my recommendation)

Build codewalker as a **two-layer store**:

1. **Markdown cards = source of truth.** Human-readable, git-diffable, editable by hand or
   by the agent. One card per symbol / library / decision.
2. **SQLite + FTS5 = a disposable index** derived from the cards (and from a fast
   structural scan of the code). You can delete `index.db` and rebuild it from markdown at
   any time. This is what keeps the infra "minimal" — the database is a *cache*, not a
   system of record.

Everything else (extraction, sync, query) hangs off that split. Keep `/learn-this` as the
"project knowledge" entry point and add `/codewalker` subcommands for the codebase and
library layers.

**Verified on this machine (2026-06-28):**
- `node:sqlite` (Node 24.18) ships FTS5 — **zero npm dependencies**, no flag needed.
- `bun:sqlite` (Bun 1.3) ships FTS5 too.
- Universal Ctags 6.2.1 is installed — multi-language symbol extraction with no npm dep.

So the whole thing can run with **0 production npm dependencies**: the runtime's built-in
SQLite + an optional external `ctags` binary + markdown files.

---

## 0.5 North star: retrieval over scanning (the real point)

The goal of this extension is **not** "a knowledge base" for its own sake. It is **token
economy and context hygiene**: stop the agent from blindly scanning files, and feed the model
**only the facts a task actually needs**. *If we don't need it, don't process it; if we don't
need it in context, don't put it there.* Every design choice below serves that.

**The problem today.** A bare agent answering "where do we refresh the auth token?" does
`glob` → `grep` → `read` on 8–10 files. Most of those bytes are irrelevant, but they all land
in the context window: thousands of tokens of noise, paid for on **every** such request,
crowding out room for actual reasoning, and re-paid the next time because nothing was retained.

**The fix: pay the scan once, out of band; query cheaply, many times.**

| | Naive agent (scan every time) | Codewalker (retrieve) |
|---|---|---|
| Where the file scan happens | **inside** the LLM context, every request | **outside** the context, once (ctags build) |
| What enters context | whole files, mostly irrelevant | a few compact, exact facts |
| Tokens per "where is X?" | thousands | tens–low hundreds |
| Repeat cost | full price again | a second cheap query |
| Freshness signal | none (agent guesses) | git-anchored confidence line (§5) |

The expensive, dirty work (walking the tree, extracting symbols) is **mechanical** (ctags),
runs **out-of-band as a build step**, and **never passes through the LLM context window**. The
agent then spends tokens only on a tiny query and a tiny, ranked, exact answer.

### Design principles this implies (binding on the rest of the doc)

1. **Index out of band; never scan in-context.** Building/refreshing `index.db` is a CLI/build
   step, not something the agent does mid-conversation by reading files. The conversation only
   ever *queries*.
2. **Compact by default; expand on demand (progressive disclosure).** A query returns a
   token-bounded, ranked list of *facts* — `name · kind · file:line · one-line summary` — **not**
   file contents. The agent pulls a full card or opens the exact `file:line` span **only** for
   the few hits it actually needs. This is the single biggest token lever.
3. **Exact location, not a haystack.** Returning `src/auth/token.ts:42-71` lets the agent read
   71 lines instead of grepping the repo and reading whole files. Precise pointers replace broad
   reads.
4. **Retain, don't re-derive.** Facts captured once (symbols, summaries, decisions) are reused
   across turns and sessions, so the same scan is never paid twice.
5. **Earn every token in context.** The semantic/LLM pass (Tier 3, §4) is lazy and scoped
   precisely because it is the only step that costs model tokens — so it runs only where it pays.

This is also why a vector DB is the wrong default here (see
[tech-decision.md](./tech-decision.md)): embeddings would *add* an indexing cost and fuzzier,
larger results, when the win we want is **fewer, exact facts in context** — which keyword +
structural retrieval delivers directly.

---

## 0.6 Two audiences, one source of truth (yes, you get both)

The natural worry is that "complete knowledge base for humans" and "token economy for the
agent" pull against each other — a complete KB sounds like *more* tokens. **They don't pull
against each other**, because completeness and token economy live in different places:

- **Completeness is a property of the store** (markdown on disk, in git). Verbose, exhaustive,
  cross-linked — and it costs **zero** LLM tokens, because nothing on disk is in the context
  window until something asks for it.
- **Token economy is a property of retrieval** (what crosses into the context window). The
  agent never loads the store; it queries an index and pulls only the slices a task needs.

So it's **one corpus, two projections of the same data**:

| | Human surface | Agent surface |
|---|---|---|
| What it is | the full markdown KB in `~/.pi/projects/<id>/codewalker/` — open the dir in an editor, or render to a static site | FTS index → compact facts → expand-on-demand |
| Optimized for | **completeness & readability** | **fewest exact tokens in context** |
| Verbosity | as rich as you like (free) | bounded, compact, ranked |
| Source | the cards | **the same cards** |

Think of it as a **map with zoom**: humans zoom all the way in to full detail; the agent reads
coordinates (`file:line`, a one-liner) and fetches only the tiles it needs. Same map.

### The one real tension, and how a card resolves it

The projections only collide in one spot: when the agent expands a **full card** that was
written verbosely *for humans*, those human words become agent tokens. Solve it **inside the
card** — a structured head (agent-cheap) above a narrative body (human-rich), so even "expand"
is progressive:

```markdown
---                          # ← HEAD: machine/agent-facing, tiny, what `query` returns
name: probeCompat
kind: function
signature: (cwd: string) => CompatResult
location: compat.ts:201-243
tags: [integration, minion, memory, detection]
summary: Detect whether minion & memory are active for the project at cwd.
---

# probeCompat                # ← BODY: human-facing, as rich as you want, NOT pulled by default

Walks up from `cwd` to the project root, reads the `.pi/<id>.md` marker, then probes
`~/.pi/projects/<id>/{tasks,memory}/`. Returns a flat `CompatResult`...

## Why it exists
<design rationale, ADR links, diagrams, examples, gotchas — humans read this; the agent
only reads it on an explicit `--full`, and usually never needs to>
```

- **`query` returns the head only** (frontmatter fields) → tens of tokens, exact.
- **Humans render the whole file** → a complete doc page.
- **The agent reads the body only when a task truly needs the "why"** — a deliberate,
  rare, paid step, never the default.

One file serves both, so the two surfaces **cannot drift** — there is no second copy to keep in
sync. Curating richer human docs makes the agent's facts better *and* keeps its default payload
just as small. **The completeness and the economy are the same artifact, seen at two zoom
levels.**

---

## 1. How this maps to your four goals

| Your goal | Layer | What it becomes |
|---|---|---|
| Deep **project** knowledge (bridge human ↔ agent) | Project | Extends today's `/learn-this`: PRD/AGENTS.md/CLAUDE.md + a **glossary** and **decisions** card set, indexed for query. |
| Deep **codebase** knowledge (map constants/functions) | Code | A **symbol index**: one card per function/const/class/type, with signature, location, callers, and an optional semantic summary. |
| Deep **library** knowledge (fetch & extract) | Library | Cards extracted from `node_modules` (`.d.ts` + README + `package.json`), version-pinned; web fetch only as fallback. |
| **Code analyzer** (coverage/quality/best practice) | Analysis | Report cards generated from existing artifacts (lcov, lint output, TODO scan) + agent review against the project's own conventions. |

All four share **one SQLite index + one FTS5 search surface**, so a single query like
`codewalker query "auth token refresh"` returns hits across project notes, symbols, library
APIs, and analysis findings, ranked together.

---

## 2. Storage layout

**Everything codewalker generates lives in the global pi directory, project-scoped — exactly
the way `@aprimediet/memory` does it. The working repo stays clean: the only files codewalker
writes into it are the three human front-door docs.**

```
# In the repo — the ONLY files codewalker touches here (the human front door)
<repo>/
  README.md                        # project readme (human)
  PRD.md   (or docs/PRD.md)        # product requirements (human) — from /learn-this
  AGENTS.md                        # coding-agent guide (+ thin CLAUDE.md pointer) — from /learn-this

# Everything else — GLOBAL, project-scoped, mirrors ~/.pi/projects/<id>/memory/
~/.pi/projects/<id>/codewalker/
  CODEWALKER.md                    # human-readable index/overview   (≈ memory's MEMORY.md)
  index.db                         # SQLite + FTS5 (disposable, rebuildable)
  meta.json                        # last-indexed commit, schema version
  entries/                         # the markdown cards              (≈ memory's entries/)
    symbols/<file-hash>/<symbol>.md
    libs/<pkg>@<version>/<symbol>.md
    glossary/*.md                  # domain term ↔ code (bridge cards)
    decisions/*.md                 # ADR-style "why" cards
    conventions.md                 # curated coding conventions
    analysis/*.md                  # coverage/quality findings
```

Rules / rationale:
- **Project-scoped only — no global/cross-project knowledge.** Codewalker is always keyed to
  one project id (the existing `.pi/<id>.md` marker) and writes only under
  `~/.pi/projects/<id>/codewalker/`. There is **no shared/global codewalker store**; nothing
  leaks between projects. (Memory offers a global scope; codewalker deliberately omits it.)
- **Clean repo.** The repo contains only `README.md`, `PRD.md`, and `AGENTS.md` (+ the thin
  `CLAUDE.md` pointer). All symbol / library / decision / glossary / analysis cards, the index,
  and the `CODEWALKER.md` overview live in the global dir. No `.codewalker/` folder in the repo,
  nothing to `.gitignore`, no index churn in diffs.
- **Same shape as memory.** `CODEWALKER.md` ≈ `MEMORY.md` (the readable index); `entries/` ≈
  memory's `entries/` (one markdown card per item). Reuses the `.pi/<id>.md` marker and
  `getAgentDir()` plumbing already in `compat.ts` — no new identity mechanism.
- **Disposable index.** `index.db` is rebuildable from `entries/` + a code scan at any time
  (`codewalker reindex`); the markdown cards remain the source of truth.

> **Tradeoff being accepted (by design):** because the KB lives in the global dir, it is
> **per-machine and not shared via git** with teammates — that is the explicit goal (clean
> repo). If team sharing is ever wanted later, add an opt-in `codewalker export` that snapshots
> `entries/` into the repo on demand. Not the default.

---

## 3. SQLite schema (starter)

One content table + FTS5 mirror per collection, plus a `meta` table. FTS5 `external content`
tables keep the index small by pointing back at the base rows.

```sql
PRAGMA user_version = 1;

-- Tracks what's been indexed, for git-anchored incremental sync (see §5)
CREATE TABLE files (
  path        TEXT PRIMARY KEY,
  lang        TEXT,
  blob_sha    TEXT,          -- git blob sha or content hash
  indexed_at  TEXT
);

CREATE TABLE symbols (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT,          -- function | const | class | type | method | enum
  file_path   TEXT,
  line_start  INTEGER,
  line_end    INTEGER,
  signature   TEXT,
  doc         TEXT,          -- leading comment / docstring (mechanical)
  summary     TEXT,          -- agent-written semantic summary (lazy, optional)
  card_path   TEXT
);

-- Full-text surface. Mirrors the searchable columns of `symbols`.
CREATE VIRTUAL TABLE symbols_fts USING fts5(
  name, signature, doc, summary,
  content='symbols', content_rowid='id',
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE libraries (
  name TEXT, version TEXT, source TEXT,   -- source: node_modules | web
  PRIMARY KEY (name, version)
);
CREATE TABLE lib_symbols (
  id INTEGER PRIMARY KEY, lib TEXT, version TEXT,
  name TEXT, signature TEXT, doc TEXT, card_path TEXT
);
CREATE VIRTUAL TABLE lib_symbols_fts USING fts5(
  name, signature, doc, content='lib_symbols', content_rowid='id'
);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
-- meta: last_indexed_commit, schema_version, last_full_reindex
```

Notes:
- Use **triggers** (or just rewrite-on-update in code) to keep `*_fts` in sync with base
  tables. For a rebuildable cache, the simplest correct approach is: on reindex of a file,
  `DELETE` its rows + FTS rows, then re-`INSERT`.
- `bm25(symbols_fts)` gives ranking for free. Boost `name`/`summary` over `doc` with column
  weights: `bm25(symbols_fts, 10.0, 5.0, 1.0, 8.0)`.
- One DB file, WAL mode (`PRAGMA journal_mode=WAL`) so a long agent session can read while a
  background sync writes.

---

## 4. Extraction strategy (the hard part — keep it tiered)

Don't try to build a perfect AST indexer. Use **three tiers**, cheapest first, each
optional and degrading gracefully:

**Tier 1 — Structural map (mechanical, cheap, complete).**
"What symbols exist and where." This is the backbone.
- **Primary: Universal Ctags** (already installed). One command emits JSON tags across ~40
  languages: `ctags --output-format=json --fields=+nKzS -R .`. Parse → `symbols` rows. Zero
  npm dep; covers the entire language list in today's `detect.ts` and more.
- **Fallback if ctags absent:** per-language regex extractors for the top stack (TS/JS, Py,
  Go, Rust). Less accurate but zero external dep. Detect ctags on PATH and pick automatically.
- **Optional upgrade:** the pi `LSP` tool (document symbols) or tree-sitter-wasm for
  call-graph edges later. Not needed for v1.

**Tier 2 — Doc extraction (mechanical).**
Pull the leading block comment / JSDoc / docstring above each symbol → `symbols.doc`. Pure
string work on the source slice ctags already located. No parsing of semantics.

**Tier 3 — Semantic enrichment (agentic, lazy, selective).**
"What it does and why" → `symbols.summary` + a richer markdown card. This is where the
*coding agent itself* reads the code and writes a summary. **Do this lazily**, never for the
whole repo at once:
- On demand when a query returns a symbol with no summary, or
- For a user-selected subsystem (`/codewalker enrich src/auth`), or
- Opportunistically for symbols touched in recent commits.

This tiering is what keeps cost sane: Tier 1+2 index the *entire* repo for ~free in seconds;
Tier 3 (the expensive LLM pass) only runs where it pays off.

**Libraries:** prefer **local-first** extraction — read the *installed* version's
`node_modules/<pkg>/`:
- `package.json` (entry points, version), `README.md`, and especially **`.d.ts` type
  declarations** (the full API surface, version-accurate, no network).
- Only fall back to `WebFetch` (npm registry / docs site) when local material is thin.
- Card per exported symbol, keyed by `<pkg>@<version>` so upgrades re-extract cleanly.

---

## 5. Freshness: git-anchored incremental sync

The classic failure of code indexes is silent staleness. Anchor the index to a git commit:

- Store `meta.last_indexed_commit`.
- `codewalker sync` runs `git diff --name-only <last_indexed_commit> HEAD` (+ `git status`
  for uncommitted changes) → re-extract **only changed files**, delete rows for deleted
  files, update `last_indexed_commit`.
- For non-git repos or untracked edits, fall back to content-hash (`blob_sha`) comparison
  per file.
- **Every query result reports confidence:** e.g. `indexed @abc123; HEAD @def456 (7 files
  changed since — run codewalker sync)`. The agent then knows when to trust vs. re-scan.

This makes incremental updates trivial and gives the agent an honest staleness signal
instead of confidently-wrong answers.

---

## 6. Query interface

Two complementary access paths; both hit the same DB.

**A. CLI the agent calls via Bash (primary — most "minimal infra").**
Ship a tiny query entry point. The agent already has Bash; no special tool wiring needed,
and it works for any agent/runtime:
```
codewalker query "token refresh"        # FTS across all collections, ranked
codewalker query --kind=function "parse frontmatter"
codewalker who-calls detectTechStack    # if call edges indexed (later)
codewalker lib hono "createMiddleware"
```
**Output is compact by default (the token lever, per §0.5).** A query returns a ranked,
token-bounded list of *facts*, not file contents — one line per hit:
```
detectTechStack   function  detect.ts:71-118   scan package.json for frameworks  [card: …]
probeCompat       function  compat.ts:201-243  detect minion & memory integration [card: …]
```
The agent then pulls the **full card** (`--full <id>`) or opens the exact **`file:line` span**
only for the one or two hits it actually needs. Default result size is bounded (e.g. top 10,
`--limit` to widen) so a query can never dump the repo into context. Markdown-as-output keeps
the few expanded results human-grokkable.

**B. Registered pi command + skill (ergonomic).**
- `/codewalker query …`, `/codewalker sync`, `/codewalker enrich …` registered with
  `pi.registerCommand` (same pattern as today's `learn-this` in `index.ts`).
- A `codewalker` **skill** (SKILL.md) teaches the agent *when* to query the index before
  editing — e.g. "before modifying a symbol, query for its callers and the relevant
  conventions/decisions cards." This is what actually makes the knowledge *bridge* into the
  agent's workflow rather than sitting unused.
- If the pi SDK exposes tool registration (verify — `registerCommand` is confirmed in
  `index.ts`, tool registration is not yet), expose `codewalker_query` as a first-class tool
  so the agent can call it mid-turn without shelling out.

---

## 7. Commands / surface area

| Command | Layer | Does |
|---|---|---|
| `/learn-this` | Project | (existing) tech stack, goals, PRD/AGENTS.md/CLAUDE.md, integration detection |
| `/codewalker index` | Code | full Tier-1+2 extraction → build `index.db` from scratch |
| `/codewalker sync` | Code | git-anchored incremental re-extract |
| `/codewalker enrich <path>` | Code | Tier-3 agent summaries for a subsystem |
| `/codewalker libs` | Library | extract installed deps from `node_modules` |
| `/codewalker analyze` | Analysis | coverage/quality/best-practice report cards |
| `/codewalker query <text>` | all | FTS search across everything |

---

## 8. Code analyzer (goal 4) — report, don't gate

Generate **analysis cards**, not a CI gate. Pull from artifacts that already exist, plus a
focused agent pass:
- **Coverage:** parse `coverage/lcov.info` or `coverage-final.json` if present → per-file
  covered/uncovered; flag low-coverage hot files. (Reuse the test-presence check already in
  `detect.ts`.)
- **Quality/debt:** the existing TODO/FIXME/HACK scan, plus `// @ts-ignore`/`@ts-nocheck`
  counts, file-size / function-length heuristics, and lint output if a linter is configured.
- **Best practice:** agent reviews changed/selected files **against the project's own
  `conventions.md` and decisions cards** (in the global codewalker dir) — so advice is grounded
  in *this* codebase, not generic rules. Findings become `analysis/*.md` cards, indexed and
  queryable.

"Works best if we…" → works best when **conventions and decisions are captured first**
(via `/learn-this` + glossary/decisions cards), because then the analyzer measures against a
real standard instead of guessing.

---

## 9. Dependencies — the minimal-infra ledger

| Concern | Choice | Cost |
|---|---|---|
| Database | `node:sqlite` (Node ≥22.5, stable in 24) or `bun:sqlite` | **0 npm deps** — built into runtime |
| Full-text search | SQLite **FTS5** (bundled, verified on this box) | 0 |
| Symbol extraction | Universal **ctags** binary (detect on PATH) | 0 npm; 1 optional system binary |
| Fallback extraction | per-language regex in the extension | 0 |
| Library docs | read `node_modules` `.d.ts`/README locally | 0 (network only as fallback) |
| Storage | plain markdown files | 0 |

If you ever need to drop the ctags system dependency entirely, the regex fallback keeps the
top-stack languages working with literally zero external anything. If you want one native dep
for portability/perf instead of `node:sqlite`, `better-sqlite3` (bundles its own SQLite +
FTS5) is the standard fallback — but you don't need it given the verification above.

---

## 10. Suggested phasing

- **v1.1 — Code index MVP.** ctags→SQLite/FTS5, `index`/`sync`/`query` CLI, git-anchored
  freshness, query skill. (Tiers 1–2 only; no LLM cost.) This alone gives the agent a fast,
  honest "where is X / what exists" map.
- **v1.2 — Library layer.** `node_modules` `.d.ts`/README extraction → lib cards + FTS.
- **v1.3 — Semantic + bridge layer.** Lazy Tier-3 enrichment; `glossary` & `decisions` cards
  (in the global dir); skill rules that make the agent *consult* the index before editing.
- **v1.4 — Analyzer.** Coverage/quality/best-practice report cards grounded in conventions.

Each phase is independently useful and ships without the next.

---

## 11. Relationship to existing companions (don't duplicate)

- **`memory`** = durable freeform facts/decisions across sessions. Codewalker **mirrors
  memory's storage shape** (`CODEWALKER.md` + `entries/` under `~/.pi/projects/<id>/`) but is
  **project-scoped only** and owns *structured code/library* knowledge. Codewalker's
  `decisions/` could *feed* memory, but the two stores stay separate.
- **`minion`** = task/kanban state. Untouched.
- **`learn-this`** = project-level snapshot. Becomes codewalker's "project layer" entry
  point; the new code/library/analysis layers extend it.

Codewalker's job is the one thing neither of those does: a **queryable, fresh map of the
code and its libraries.** Keep the boundaries clean and let `query` optionally surface
memory hits alongside symbol hits.

---

## 12. Risks & open questions

1. **Index staleness** — mitigated by git-anchoring + per-query confidence line. Biggest UX
   risk; worth getting right in v1.1.
2. **Extraction accuracy across languages** — ctags is broad but shallow (no types/call
   graph). Fine for "what/where"; upgrade to tree-sitter/LSP only if call-graph queries
   prove needed.
3. **Tier-3 cost** — must stay lazy and user-scoped; never auto-enrich a whole repo.
4. **No team sharing by default** — the KB lives in the global dir, so it's per-machine and not
   shared via git (deliberate, for a clean repo). Add opt-in `codewalker export` later if team
   sharing is wanted (see §2).
5. **SDK tool registration** — confirm whether pi lets extensions register tools (not just
   commands); if not, the Bash-CLI path is the fallback and works fine.
6. **Monorepo / very large repos** — may need per-package indexes or path scoping; defer
   until it bites.

---

### Bottom line
The point is **token economy**: pay the file scan once, out of band and outside the LLM
context (ctags → SQLite), then feed the model only a few exact facts per request instead of
letting it grep-and-read its way through the repo. Markdown is the asset; SQLite+FTS5 is a
rebuildable index over it; ctags does the cheap heavy lifting; the agent spends model tokens
only on tiny queries and the handful of cards a task truly needs. That's a real codebase index
with **zero required npm dependencies**, nothing to operate, and a context window kept clean —
exactly the "powerful but minimal infra, don't process what we don't need" target.
