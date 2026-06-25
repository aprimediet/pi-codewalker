import { type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { probeCompat } from "./compat.ts";

export default function codewalkExtension(pi: ExtensionAPI): void {
	pi.registerCommand("learn-this", {
		description: "Analyze this project: tech stack, goals, status, issues, then generate PRD + AGENTS.md/CLAUDE.md.",
		handler: async (_args, ctx: ExtensionContext) => {
			const compat = probeCompat(ctx.cwd);

			const minionLine = compat.minionActive
				? `minion: active (project ${compat.projectId}, ${compat.openTaskCount} open tasks)`
				: "minion: not detected";

			const memoryLine = compat.memoryActive
				? `memory: active (${compat.memoryEntries} entries)`
				: "memory: not detected";

			// Surface the probe result to the user immediately (TUI only).
			if (ctx.hasUI) {
				ctx.ui.notify(
					["codewalker: starting /learn-this", `  ${minionLine}`, `  ${memoryLine}`].join("\n"),
					"info",
				);
			}

			// Actually kick off the workflow: send a user message that triggers an agent turn.
			// The agent invokes the learn-this skill and runs all 9 phases. We hand it the
			// integration facts up front so Phase 7 (and Phase 9 storage) start from real data.
			const directive = [
				"Run the /learn-this project intelligence workflow on the current working directory now.",
				"Invoke the `learn-this` skill and complete every phase and checklist item in order.",
				"Do not stop after detection — gather goals interactively (one question at a time) where they are missing, generate the docs (docs/PRD.md for humans, AGENTS.md + CLAUDE.md for coding agents, with the audience-correct content split), and finish with the summary and memory storage steps.",
				"",
				"Integration status detected by codewalker (use these facts in Phase 7 and Phase 9):",
				`- ${minionLine}`,
				`- ${memoryLine}`,
				compat.projectId ? `- project id: ${compat.projectId}` : "- project id: none (no .pi marker found)",
			].join("\n");

			pi.sendUserMessage(directive, { deliverAs: "followUp" });
		},
	});
}
