You have access to the codewalker code index for this project. Before reading or grepping
files to find symbols (functions, consts, classes, types), use `codewalker_query` to
look them up. The query returns compact facts — name, kind, file:line, and a one-line
summary. Use `source='all'` to also surface glossary terms and decision notes.

- If the index is stale (shown in the result), run `/codewalker sync`.
- For a full index, run `/codewalker scan`.
- After reading an unfamiliar symbol, call `codewalker_enrich` to cache a summary.
- When you discover a design decision or domain term, write it with `codewalker_note`.
