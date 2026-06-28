/**
 * @aprimediet/codewalker
 *
 * Queryable, token-economical project & code index for the pi coding agent.
 *
 * Registers:
 * - `codewalker_query` tool (agent-facing, compact results) — now with `source` param
 * - `/codewalker` command (human-facing) with subcommands scan, sync, query, libs, lib
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveProject, ensureProject } from "./project.ts";
import { runQuery } from "./query.ts";
import { scan, sync } from "./indexer.ts";
import { indexLibraries } from "./libs/indexer.ts";
import { formatCompact } from "./format.ts";
import { openDb, selectUnenrichedSymbols, updateSymbolSummary, searchNotes, upsertNote } from "./db.ts";
import { updateCardSummary } from "./cards.ts";
import { addNote } from "./notes.ts";
import { formatEnrichWorklist, validateEnrichPath, checkEnrichCap } from "./enrich.ts";
import type { NoteKind } from "./types.ts";

export default function codewalkerExtension(pi: ExtensionAPI): void {
  // ----------------------------------------------------------------- tools

  // -- codewalker_query (v1.1 — extended with source='notes'|'all')
  pi.registerTool({
    name: "codewalker_query",
    label: "Codewalker Query",
    description:
      "Search the project's code index for symbols (functions, consts, classes, types). " +
      "Returns compact facts (name, kind, file:line, one-line summary) — use this BEFORE grepping/reading files. " +
      "Optionally search libraries (source='libs') or notes/glossary/decisions (source='notes') or both (source='all').",
    parameters: Type.Object({
      query: Type.String({ description: "Search text — symbol name or concept keywords." }),
      kind: Type.Optional(Type.String({ description: "Filter: function|const|class|type|method|enum|glossary|decision" })),
      limit: Type.Optional(Type.Number({ description: "Max hits (default 10)." })),
      source: Type.Optional(Type.String({ description: "Where to search: code | libs | notes | all (default code)." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const p = params as any;
      const project = resolveProject(ctx.cwd);
      const { rows, staleness } = runQuery(
        project.dbPath,
        {
          query: p.query as string,
          kind: p.kind as string | undefined,
          limit: p.limit as number | undefined,
          source: (p.source as "code" | "libs" | "notes" | "all") ?? "code",
        },
        project.root,
      );

      const text = formatCompact(rows, staleness);
      return {
        content: [{ type: "text" as const, text }],
        details: { rows },
      };
    },
  });

  // -- codewalker_enrich (v1.3 — write a semantic summary back to a symbol)
  pi.registerTool({
    name: "codewalker_enrich",
    label: "Codewalker Enrich",
    description:
      "Write a one-line semantic summary back to a symbol's card and DB index. " +
      "Call this AFTER reading the symbol's source span. The summary (≤120 chars) " +
      "is cached so future queries surface meaning, not just names.",
    parameters: Type.Object({
      card: Type.String({ description: "card_path of the symbol (from the enrich worklist)." }),
      summary: Type.String({ description: "One-line (≤120 char) plain-English summary of what it does." }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const p = params as any;
      const card = p.card as string;
      const summary = p.summary as string;
      const project = resolveProject(ctx.cwd);

      // Resolve the card path (may be absolute or relative to codewalker dir)
      let cardPath = card;
      if (!path.isAbsolute(cardPath)) {
        cardPath = path.resolve(project.codewalkerDir, card);
      }

      // Check the card file exists
      if (!fs.existsSync(cardPath)) {
        return {
          content: [{ type: "text" as const, text: `No card file found at ${cardPath}.` }],
          details: { error: "card_not_found" },
        };
      }

      // Read and update the card
      const cardContent = fs.readFileSync(cardPath, "utf-8");
      const updated = updateCardSummary(cardContent, summary);

      // Atomic write back to the card file
      const tmpPath = cardPath + ".tmp";
      fs.writeFileSync(tmpPath, updated, { encoding: "utf-8", mode: 0o600 });
      fs.renameSync(tmpPath, cardPath);

      // Update DB
      const db = openDb(project.dbPath);
      let updatedRow = false;
      try {
        updatedRow = updateSymbolSummary(db, cardPath, summary);
      } finally {
        db.close();
      }

      if (!updatedRow) {
        return {
          content: [{ type: "text" as const, text: `Card ${path.basename(cardPath)} updated but no matching symbol row found in DB. Run /codewalker scan first.` }],
          details: { card_updated: true, db_updated: false },
        };
      }

      return {
        content: [{ type: "text" as const, text: `Summary written to ${path.basename(cardPath)} and indexed.` }],
        details: { card_updated: true, db_updated: true, card_path: cardPath, summary },
      };
    },
  });

  // -- codewalker_note (v1.3 — write a glossary term or decision)
  pi.registerTool({
    name: "codewalker_note",
    label: "Codewalker Note",
    description:
      "Write a glossary term or decision note. Persists to a markdown card " +
      "under entries/{glossary,decisions}/ and the FTS index. Future queries " +
      "will surface this conceptual knowledge alongside code symbols.",
    parameters: Type.Object({
      type: Type.String({ description: "glossary | decision" }),
      title: Type.String({ description: "Glossary term, or decision title." }),
      body: Type.String({ description: "The definition, or the decision + rationale." }),
      tags: Type.Optional(Type.String({ description: "Comma-separated tags." })),
      related: Type.Optional(Type.String({ description: "Comma-separated symbol names or file:line refs." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const p = params as any;
      const type = (p.type as string).toLowerCase();

      if (type !== "glossary" && type !== "decision") {
        return {
          content: [{ type: "text" as const, text: `Invalid note type "${type}". Must be "glossary" or "decision".` }],
          details: { error: "invalid_type" },
        };
      }

      const project = await ensureProject(ctx.cwd);
      const notesDir = type === "glossary" ? project.glossaryDir : project.decisionsDir;

      addNote(project.dbPath, {
        note_kind: type as NoteKind,
        title: (p.title as string).trim(),
        body: (p.body as string).trim(),
        tags: (p.tags as string ?? "").trim(),
        related: (p.related as string ?? "").trim(),
        card_path: "",
      }, notesDir);

      return {
        content: [{ type: "text" as const, text: `${type === "glossary" ? "Glossary term" : "Decision"} "${p.title}" saved and indexed.` }],
        details: { type, title: p.title },
      };
    },
  });

  // ----------------------------------------------------------------- command
  pi.registerCommand("codewalker", {
    description:
      "codewalker: scan | sync | query <text> | enrich <path> [--max=N] | glossary [query] | decisions [query] | libs [--dev] | lib <pkg> [query] | help\n" +
      "  scan              Full (re)build of the code index\n" +
      "  sync              Git-anchored incremental update\n" +
      "  query <text>      Search the code index (pass source=notes to include glossary/decisions)\n" +
      "  enrich <path>     Select unenriched symbols under <path> and write summaries\n" +
      "  glossary [query]  Search glossary terms\n" +
      "  decisions [query] Search decision notes\n" +
      "  libs [--dev]      Index all direct dependencies (--dev includes devDependencies)\n" +
      "  lib <pkg> [query] Search a specific library's API symbols\n" +
      "  help              Show this help",
    handler: async (args, ctx) => {
      const tokens = (args ?? "").trim().split(/\s+/).filter(Boolean);
      const sub = tokens[0] ?? "help";
      const notify = (msg: string, level: "info" | "error" = "info") => {
        if ((ctx as any).hasUI) (ctx as any).ui.notify(msg, level);
        else console.log(msg);
      };

      try {
        const project = await ensureProject(ctx.cwd);

        switch (sub) {
          case "scan": {
            notify("Starting codewalker full scan…");
            await scan({
              projectRoot: project.root,
              globalCodewalkerDir: project.codewalkerDir,
              dbPath: project.dbPath,
              entriesDir: project.entriesDir,
              symbolsDir: project.symbolsDir,
            });
            notify("Codewalker scan complete.");
            break;
          }

          case "sync": {
            notify("Starting codewalker incremental sync…");
            await sync({
              projectRoot: project.root,
              globalCodewalkerDir: project.codewalkerDir,
              dbPath: project.dbPath,
              entriesDir: project.entriesDir,
              symbolsDir: project.symbolsDir,
            });
            notify("Codewalker sync complete.");
            break;
          }

          case "query": {
            const q = tokens.slice(1).join(" ");
            if (!q) {
              notify("Usage: /codewalker query <text>", "error");
              return;
            }
            const { rows, staleness } = runQuery(project.dbPath, { query: q, limit: 10 }, project.root);
            const text = formatCompact(rows, staleness);
            notify(text);
            break;
          }

          // ── v1.3: enrich ───────────────────────────────────
          case "enrich": {
            const enrichPath = tokens[1];
            const pathCheck = validateEnrichPath(enrichPath);
            if (!pathCheck.valid) {
              notify(pathCheck.error!, "error");
              return;
            }

            // Parse optional --max=N
            const maxToken = tokens.find(t => t.startsWith("--max="));
            const cap = maxToken ? parseInt(maxToken.slice(6), 10) : 40;

            // Select unenriched symbols
            const db = openDb(project.dbPath);
            let symbols;
            try {
              symbols = selectUnenrichedSymbols(db, enrichPath!, cap + 1); // get one extra to detect overflow
            } finally {
              db.close();
            }

            // Cap check
            const capCheck = checkEnrichCap(symbols.length, cap);
            if (!capCheck.ok) {
              notify(capCheck.error!, "error");
              return;
            }

            if (symbols.length === 0) {
              notify(`No unenriched symbols found under "${enrichPath}".`);
              return;
            }

            // Format the worklist
            const worklist = formatEnrichWorklist(symbols, enrichPath!);

            // With UI, drive the agent; without UI, print the worklist
            if ((ctx as any).hasUI) {
              notify(worklist);
              try {
                (ctx as any).sendUserMessage?.(worklist);
              } catch {
                // sendUserMessage may not be available in all contexts
              }
            } else {
              console.log(worklist);
            }
            break;
          }

          // ── v1.3: glossary ─────────────────────────────────
          case "glossary": {
            const q = tokens.slice(1).join(" ");
            const db = openDb(project.dbPath);
            let rows;
            try {
              rows = searchNotes(db, q || "", "glossary", 20);
            } finally {
              db.close();
            }
            const text = formatCompact(rows as any, null);
            notify(text || "No glossary terms found.");
            break;
          }

          // ── v1.3: decisions ────────────────────────────────
          case "decisions": {
            const q = tokens.slice(1).join(" ");
            const db = openDb(project.dbPath);
            let rows;
            try {
              rows = searchNotes(db, q || "", "decision", 20);
            } finally {
              db.close();
            }
            const text = formatCompact(rows as any, null);
            notify(text || "No decision notes found.");
            break;
          }

          case "libs": {
            const includeDev = tokens.includes("--dev");
            notify(`Indexing libraries${includeDev ? " (including devDependencies)" : ""}…`);
            const result = await indexLibraries({
              projectRoot: project.root,
              libsDir: project.libsDir,
              dbPath: project.dbPath,
              includeDev,
            });
            if (result.indexed === 0 && result.symbols === 0) {
              notify("No libraries indexed. Ensure node_modules exists and has dependencies installed.");
            } else {
              notify(`Indexed ${result.indexed} libraries, ${result.symbols} symbols${result.errors > 0 ? ` (${result.errors} errors)` : ""}.`);
            }
            break;
          }

          case "lib": {
            const pkg = tokens[1];
            if (!pkg) {
              notify("Usage: /codewalker lib <pkg> [query]", "error");
              return;
            }
            const q = tokens.slice(2).join(" ");
            const { rows, staleness } = runQuery(
              project.dbPath,
              { query: q || "", source: "libs", limit: 20 },
              project.root,
            );
            // Filter to the requested package
            const pkgRows = rows.filter(r => r.lib === pkg || r.name === pkg);
            if (pkgRows.length === 0) {
              notify(`No API symbols found for "${pkg}". Run /codewalker libs first to index libraries.`);
            } else {
              const text = formatCompact(pkgRows, staleness);
              notify(text);
            }
            break;
          }

          default: {
            notify(
              "codewalker: scan | sync | query <text> | enrich <path> [--max=N] | glossary [query] | decisions [query] | libs [--dev] | lib <pkg> [query] | help\n" +
              "  scan              Full (re)build of the code index\n" +
              "  sync              Git-anchored incremental update\n" +
              "  query <text>      Search the code index (pass source=notes to include glossary/decisions)\n" +
              "  enrich <path>     Select unenriched symbols under <path> and write summaries\n" +
              "  glossary [query]  Search glossary terms\n" +
              "  decisions [query] Search decision notes\n" +
              "  libs [--dev]      Index all direct dependencies (--dev includes devDependencies)\n" +
              "  lib <pkg> [query] Search a specific library's API symbols\n" +
              "  help              Show this help",
            );
          }
        }
      } catch (e: any) {
        notify(`codewalker error: ${e?.message ?? String(e)}`, "error");
      }
    },
  });
}
