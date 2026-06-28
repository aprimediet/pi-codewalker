You have access to the codewalker code index for this project. Before reading or grepping
files to find symbols (functions, consts, classes, types), use `codewalker_query` to
look them up. The query returns compact facts — name, kind, file:line, and a one-line
summary. Use `source='all'` to also surface glossary terms, decision notes, and analysis
findings.

- If the index is stale (shown in the result), run `/codewalker sync`.
- For a full index, run `/codewalker scan`.
- After reading an unfamiliar symbol, call `codewalker_enrich` to cache a summary.
- When you discover a design decision or domain term, write it with `codewalker_note`.
- When you learn a coding convention, record it with `codewalker_note type=convention`.
- Run `/codewalker analyze` for a health snapshot (coverage gaps, debt markers).
- Use `/codewalker review <path>` to review files against conventions and decisions,
  writing findings with `codewalker_finding`. Findings are advisory — report, don't gate.
