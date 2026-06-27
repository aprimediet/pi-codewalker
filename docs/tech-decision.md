# Tech Decision: Do we need a vector DB (ChromaDB) for codewalker?

> Companion to [claude-suggestion.md](./claude-suggestion.md). Question: to achieve the four
> goals, do we need a vector database like ChromaDB, or is **markdown + SQLite/FTS5** enough?
> Where does a vector DB actually stand?

---

## TL;DR

**No, you do not need a vector DB to achieve the goals. Start with markdown + SQLite/FTS5.**

The decisive reframing: **it was never "SQLite vs. vector DB."** SQLite can *be* the vector
DB. Verified on this machine (2026-06-28), both `node:sqlite` and `bun:sqlite` expose
`loadExtension`, so if semantic search is ever needed you load the **`sqlite-vec`** extension
and store vectors in the *same `index.db` file* — no ChromaDB, no separate service, no second
system to operate.

So the real decision is not *which database* but **when (if ever) to add a semantic layer**,
and the honest answer is: **not in v1, and probably not via ChromaDB even then.**

**This also follows from the actual goal — token economy, not search quality.** The win we
want (see [claude-suggestion.md §0.5](./claude-suggestion.md)) is *fewer, exact facts in the
LLM context* so the agent stops scanning files. Vectors push the other way: they **add** an
embedding/indexing cost, return **fuzzier and larger** candidate sets, and need re-embedding on
every edit. Keyword + structural retrieval returns a precise `file:line` and a one-line fact —
which is exactly the compact, low-token payload the design is optimizing for. A vector DB is a
recall tool; here the bottleneck is *context budget*, not recall.

---

## What each approach is actually good at

| Query | FTS5 (keyword/BM25) | Vector (semantic) |
|---|---|---|
| `detectTechStack` (exact symbol) | **Excellent** — exact token | Mediocre — needs the right phrasing |
| `parse frontmatter` (known words) | **Excellent** | Good |
| "where do we refresh auth tokens?" (concept, name unknown) | Weak unless words match | **Excellent** |
| Find synonyms / paraphrase of a doc | Weak | **Excellent** |
| API lookup in a library (`createMiddleware`) | **Excellent** | Mediocre |

**Key insight for a *code* index:** identifiers are precise tokens. Function/constant/type
names, signatures, and library API names are exactly what keyword search is best at — and
exactly what embeddings are *weakest* at (an embedding of `getUserById` carries little more
meaning than the string itself). Embeddings earn their keep on **natural-language-over-prose**
retrieval, not symbol lookup. Three of your four goals (symbol map, library API, analyzer
reports) are dominated by lexical/structural queries.

---

## The factor that changes everything: an *agent* is the consumer

Codewalker isn't a standalone search box where a human types one query and must get the
perfect hit. The consumer is the **coding agent**, which can:

- **Expand queries** — generate synonyms and try several FTS searches itself.
- **Re-rank with reasoning** — take 20 keyword candidates and pick the right one by reading
  them. The LLM *is* the semantic layer.
- **Iterate** — widen, narrow, follow `card_path`s, run `who-calls`.

This is **"agentic retrieval": keyword recall + LLM precision.** It recovers most of what
embeddings would buy you (robustness to phrasing) *without* an embedding model, because the
expensive semantic reasoning happens in the model you're already paying for. Standalone RAG
products need vectors precisely because they *can't* iterate; you can.

---

## Pros / cons

### Markdown + SQLite/FTS5 (recommended foundation)
**Pros**
- **Zero infra / zero npm deps** — built into the runtime; nothing to run or operate.
- **Exact, explainable ranking** (BM25, column weights) — great for identifiers; easy to debug "why did this match."
- **Instant, cheap updates** — re-index a changed file in ms; no embedding cost on every edit.
- **Offline, private, deterministic** — no model, no API, reproducible results.
- **Markdown stays the asset** — diffable, git-friendly, human- and agent-editable.

**Cons**
- **Lexical gap** — misses concept queries when vocabulary doesn't overlap (mitigated by agent query-expansion + a curated glossary that maps domain terms → code).
- No notion of "semantically similar" out of the box.

### Vector DB (ChromaDB specifically)
**Pros**
- **Semantic recall** — finds relevant prose even with zero shared keywords; best for NL questions over docs/comments.
- Mature ANN, metadata filtering, batteries-included.

**Cons (vs. the minimal-infra goal)**
- **Separate service/process & dependency footprint** — the opposite of "minimal infra"; one more thing to install, run, version, back up.
- **Requires an embedding model** — either a **local model** (~100MB+ ONNX/transformers.js download, CPU cost) or an **API** (network, per-token cost, sends your code off-box → privacy concern).
- **Re-embed on change** — every code edit re-embeds affected chunks = ongoing latency/cost; staleness is harder to reason about than a git-anchored FTS index.
- **Chunking complexity** — splitting code/docs well is fiddly and quality-sensitive.
- **Approximate & opaque** — fuzzy ranking, weaker exact-match guarantees, harder to debug.
- **Storage overhead** — vectors are large relative to the text they index.
- **Weak on the dominant query type** — symbol/API lookup, which is most of the workload.

---

## Where the vector approach actually stands

It's a **recall booster for natural-language-over-prose retrieval** — valuable when:
1. the corpus is large **prose** (long design docs, big READMEs, comment-heavy code), **and**
2. queries are conceptual and vocabulary-mismatched, **and**
3. the consumer **can't iterate** (not your case — the agent can).

For codewalker, that's a **narrow slice**: mainly the *project-knowledge / docs* layer, and
only once it's large. It is a **phase-2 optimization, not a foundation** — and even then the
right form is **`sqlite-vec` inside the existing DB**, not ChromaDB:

> **Hybrid search in one SQLite file:** keep FTS5 for lexical recall, add a `sqlite-vec`
> virtual table for semantic recall, fuse the two rankings (e.g. Reciprocal Rank Fusion),
> optionally let the agent re-rank the top N. You get vector-DB capability with **no separate
> server** — preserving the minimal-infra goal. `loadExtension` is available in both runtimes
> (verified), so this path is open without re-architecting.

ChromaDB would only make sense if you outgrew single-file SQLite scale (millions of chunks,
multi-tenant, distributed) — which a per-project code index will not hit.

---

## Decision & triggers

**Decision:** Build v1 on **markdown + SQLite/FTS5 + ctags + agentic retrieval**. Do **not**
adopt ChromaDB. Treat semantic search as a *measured* upgrade, not a default.

**Add a semantic layer (via `sqlite-vec`, in-process) only if these triggers fire:**
- Real usage shows the agent repeatedly fails to find conceptually-relevant code/docs even
  after query expansion, **and**
- a curated **glossary** (domain term → symbol mapping) doesn't close the gap, **and**
- the gap is concentrated in **prose** (docs/long comments), where embeddings genuinely help.

**Cheaper things to try *before* embeddings (do these first):**
1. **Glossary cards** — explicitly map domain language to code symbols; turns concept queries
   into keyword hits. Highest ROI, near-zero cost.
2. **FTS5 tuning** — synonym expansion, `porter`/`trigram` tokenizers, column weights.
3. **Agent query-expansion in the skill** — instruct the agent to try N phrasings.

**If/when you do add vectors:**
- Use **`sqlite-vec`** in the same `index.db` (not ChromaDB).
- Prefer a **local ONNX embedding model** (e.g. all-MiniLM via transformers.js) to stay
  offline/private; only use an embedding API if sending code off-box is acceptable.
- Embed **prose/summaries**, not raw symbol names (don't waste vectors where FTS already wins).
- Keep markdown as source of truth and vectors as another disposable, rebuildable index.

---

## Bottom line

The goals are dominated by **symbol/API lookup** (where keyword search beats embeddings) and
are consumed by an **agent that can reason and iterate** (which supplies the semantic layer
for free). That makes **markdown + SQLite/FTS5** not a compromise but the *right* default —
faster, cheaper, private, debuggable, and zero-infra. A vector DB is a later, optional
recall-booster for the prose layer — and when that day comes, it lives **inside SQLite via
`sqlite-vec`**, not as a separate ChromaDB service. The minimal-infra instinct is correct.
