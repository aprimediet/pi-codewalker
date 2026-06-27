/**
 * @aprimediet/codewalker
 *
 * Queryable, token-economical project & code index for the pi coding agent.
 *
 * Registers:
 * - `codewalker_query` tool (agent-facing, compact results)
 * - `/codewalker` command (human-facing) with subcommands scan, sync, query
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveProject, ensureProject } from "./project.ts";
import { runQuery } from "./query.ts";
import { scan, sync } from "./indexer.ts";
import { formatCompact, formatCardBody } from "./format.ts";

export default function codewalkerExtension(pi: ExtensionAPI): void {
  // ----------------------------------------------------------------- tool
  pi.registerTool({
    name: "codewalker_query",
    label: "Codewalker Query",
    description:
      "Search the project's code index for symbols (functions, consts, classes, types). " +
      "Returns compact facts (name, kind, file:line, one-line summary) — use this BEFORE grepping/reading files.",
    parameters: Type.Object({
      query: Type.String({ description: "Search text — symbol name or concept keywords." }),
      kind: Type.Optional(Type.String({ description: "Filter: function|const|class|type|method|enum" })),
      limit: Type.Optional(Type.Number({ description: "Max hits (default 10)." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const project = resolveProject(ctx.cwd);
      const { rows, staleness } = runQuery(
        project.dbPath,
        {
          query: (params as any).query as string,
          kind: (params as any).kind as string | undefined,
          limit: (params as any).limit as number | undefined,
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
      "codewalker: scan | sync | query <text> | help\n" +
      "  scan           Full (re)build of the code index\n" +
      "  sync           Git-anchored incremental update\n" +
      "  query <text>   Search the index for symbols\n" +
      "  help           Show this help",
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

          default: {
            notify(
              "codewalker: scan | sync | query <text> | help\n" +
              "  scan           Full (re)build of the code index\n" +
              "  sync           Git-anchored incremental update\n" +
              "  query <text>   Search the index for symbols\n" +
              "  help           Show this help",
            );
          }
        }
      } catch (e: any) {
        notify(`codewalker error: ${e?.message ?? String(e)}`, "error");
      }
    },
  });
}
