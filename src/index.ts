/**
 * @aprimediet/codewalker
 *
 * Queryable, token-economical project & code index for the pi coding agent.
 *
 * Registers:
 * - `codewalker_query` tool (agent-facing, compact results) — now with `source` param
 * - `/codewalker` command (human-facing) with subcommands scan, sync, query, libs, lib
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveProject, ensureProject } from "./project.ts";
import { runQuery } from "./query.ts";
import { scan, sync } from "./indexer.ts";
import { indexLibraries } from "./libs/indexer.ts";
import { formatCompact } from "./format.ts";

export default function codewalkerExtension(pi: ExtensionAPI): void {
  // ----------------------------------------------------------------- tool
  pi.registerTool({
    name: "codewalker_query",
    label: "Codewalker Query",
    description:
      "Search the project's code index for symbols (functions, consts, classes, types). " +
      "Returns compact facts (name, kind, file:line, one-line summary) — use this BEFORE grepping/reading files. " +
      "Optionally search libraries (source='libs') or both (source='all').",
    parameters: Type.Object({
      query: Type.String({ description: "Search text — symbol name or concept keywords." }),
      kind: Type.Optional(Type.String({ description: "Filter: function|const|class|type|method|enum" })),
      limit: Type.Optional(Type.Number({ description: "Max hits (default 10)." })),
      source: Type.Optional(Type.String({ description: "Where to search: code | libs | all (default code)." })),
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
          source: (p.source as "code" | "libs" | "all") ?? "code",
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

  // ----------------------------------------------------------------- command
  pi.registerCommand("codewalker", {
    description:
      "codewalker: scan | sync | query <text> | libs [--dev] | lib <pkg> [query] | help\n" +
      "  scan              Full (re)build of the code index\n" +
      "  sync              Git-anchored incremental update\n" +
      "  query <text>      Search the code index for symbols\n" +
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
              "codewalker: scan | sync | query <text> | libs [--dev] | lib <pkg> [query] | help\n" +
              "  scan              Full (re)build of the code index\n" +
              "  sync              Git-anchored incremental update\n" +
              "  query <text>      Search the code index for symbols\n" +
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
