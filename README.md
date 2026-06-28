# @aprimediet/codewalker

Queryable, token-economical project & code index for the pi coding agent.

## What

Instead of blindly scanning files (glob → grep → read) on every request — which floods the
context window with irrelevant bytes — codewalker builds a **mechanical code index** once,
out of band, and lets the agent query it with compact, ranked results.

**Token economy is the north star.** Pay the file scan once, outside the LLM context. Query
cheaply, many times.

## Architecture

```
source files ──→ [ctags / regex] ──→ Symbol[]
                                          ↓
                                     renderCard() → .md files (source of truth)
                                                      ↓
                                                 index.db (SQLite + FTS5, disposable)
                                                      ↓
                                              codewalker_query (compact results)

node_modules ──→ [.d.ts extract] ──→ LibSymbol[]
                                          ↓
                                     renderLibCard() → lib cards (version-pinned)
                                                      ↓
                                                 index.db (lib_symbols + FTS5)

agent knowledge ──→ codewalker_enrich / codewalker_note
                        ↓
                   cards (enrichment, glossary, decisions)
                        ↓
                   index.db (notes + FTS5, unified query)
```

- **Cards are the source of truth** — markdown in `~/.pi/projects/<id>/codewalker/entries/`.
- **SQLite + FTS5 is a disposable index** — rebuildable from cards at any time.
- **ctags primary, regex fallback** — ctags used when available, regex for TS/JS/Py/Go.
- **Library layer** — extracts API surface from `node_modules` `.d.ts` files (version-pinned).
- **Semantic + bridge layer** — agent-driven enrichment, glossary terms, and decision notes.
- **Git-anchored** — stale index detected per query.

## Commands

| Command | Description |
|---------|-------------|
| `/codewalker scan` | Full (re)build — walks project tree, extracts symbols, writes cards, populates DB |
| `/codewalker sync` | Git-anchored incremental — reindexes only changed files |
| `/codewalker query <text>` | Search the index (compact results) |
| `/codewalker enrich <path>` | Select unenriched symbols under `<path>` and write summaries |
| `/codewalker glossary [query]` | Search glossary terms |
| `/codewalker decisions [query]` | Search decision notes |
| `/codewalker libs [--dev]` | Index all direct dependencies from node_modules |
| `/codewalker lib <pkg> [query]` | Search a specific library's API symbols |

## Tools

The model can call:

| Tool | Description |
|------|-------------|
| `codewalker_query` | Search code symbols, libraries, and notes with FTS5 |
| `codewalker_enrich` | Write a one-line semantic summary back to a symbol's card + DB |
| `codewalker_note` | Write a glossary term or decision note (bridge cards) |

## Install

```bash
# In the pi extensions directory:
npm install @aprimediet/codewalker
```

Then load the extension:
```
pi -e ./node_modules/@aprimediet/codewalker/index.ts
```

## Development

```bash
npm install
npm test            # vitest — 216+ tests across 19 test files
npm run test:watch  # watch mode
```

## License

MIT
