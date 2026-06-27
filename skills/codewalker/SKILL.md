# Codewalker — Queryable Code Index

**Use this skill when:** you need to understand a codebase — find where a symbol is defined,
understand what a function does, or check if a const/class/type exists — BEFORE editing
files or grepping through the repo.

## Workflow

1. **Always query first** before editing unfamiliar code:
   ```
   /codewalker query "<symbol-name or concept>"
   ```
   This returns compact facts: `name · kind · file:line · one-line summary`.

2. **If the query returns relevant hits**, use `file:line` to read only the span you need
   instead of grepping the whole repo.

3. **If the query returns no hits**, the index may be stale or missing. Run:
   ```
   /codewalker scan
   ```
   (first run) or `/codewalker sync` (incremental update).

4. **When results include a staleness warning** (`indexed @abc, HEAD @def`), run
   `/codewalker sync` before trusting the results.

## Why

The index is built out-of-band (mechanical ctags/regex pass) so you never pay the file-scan
cost inside the LLM context. Queries return compact, ranked facts — tens of tokens instead
of thousands.

## Commands

| Command | Purpose |
|---------|---------|
| `/codewalker scan` | Full (re)build of the code index |
| `/codewalker sync` | Git-anchored incremental update |
| `/codewalker query <text>` | Search symbols by name or keyword |

## Tool

The model can also call `codewalker_query` directly (same behavior as the command).
