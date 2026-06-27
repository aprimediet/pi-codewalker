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
```

- **Cards are the source of truth** — markdown in `~/.pi/projects/<id>/codewalker/entries/`.
- **SQLite + FTS5 is a disposable index** — rebuildable from cards at any time.
- **ctags primary, regex fallback** — ctags used when available, regex for TS/JS/Py/Go.
- **Git-anchored** — stale index detected per query.

## Commands

| Command | Description |
|---------|-------------|
| `/codewalker scan` | Full (re)build — walks project tree, extracts symbols, writes cards, populates DB |
| `/codewalker sync` | Git-anchored incremental — reindexes only changed files |
| `/codewalker query <text>` | Search the index (compact results) |

## Tool

The model can call `codewalker_query` directly. Returns `content` (compact text) + `details` (full rows).

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
npm test            # vitest — 86+ tests across 12 test files
npm run test:watch  # watch mode
```

## License

MIT
