/**
 * Analysis finding card rendering and parsing for codewalker v1.4.
 *
 * PURE module — no I/O. Renders a Finding into a markdown card
 * with frontmatter head (finding_kind, title, severity, location, metric, summary) and body.
 *
 * Cards live at entries/analysis/<finding_kind>/<slug>.md.
 */

import type { Finding, FindingKind } from "../types.ts";

/**
 * Render a Finding (coverage gap, debt, or practice) into a markdown card string.
 *
 * Frontmatter head includes finding_kind, title, severity, location, metric, summary.
 * Body starts with `# <title>` and contains the full body text.
 * Summary is the first line of the body.
 */
export function renderAnalysisCard(finding: {
  finding_kind: FindingKind;
  title: string;
  severity?: string;
  file_path?: string;
  line_start?: number;
  line_end?: number;
  metric?: string;
  body?: string;
  related?: string;
  card_path?: string;
}): string {
  const lines: string[] = ["---"];

  addHeadField(lines, "finding_kind", finding.finding_kind);
  addHeadField(lines, "title", finding.title);
  if (finding.severity) addHeadField(lines, "severity", finding.severity);
  if (finding.file_path) {
    const location = finding.file_path + (finding.line_start && finding.line_start > 0 ? `:${finding.line_start}` : "");
    addHeadField(lines, "location", location);
  }
  if (finding.metric) addHeadField(lines, "metric", finding.metric);
  if (finding.related) addHeadField(lines, "related", finding.related);

  // Summary = first line of body
  const bodyText = finding.body ?? "";
  const summary = bodyText.split("\n")[0]?.trim() || finding.title;
  addHeadField(lines, "summary", summary);

  lines.push("---");
  lines.push("");

  // Body
  lines.push(`# ${finding.title}`);
  lines.push("");

  if (bodyText) {
    lines.push(bodyText);
  }

  return lines.join("\n") + "\n";
}

/**
 * Parse an analysis finding card from a markdown string.
 * Returns null if the card is invalid or not an analysis card.
 */
export function parseAnalysisCard(text: string): {
  finding_kind: string;
  title: string;
  severity: string;
  location: string;
  metric: string;
  summary: string;
} | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("---")) return null;

  const endOfFm = trimmed.indexOf("\n---", 3);
  if (endOfFm === -1) return null;

  const fmRaw = trimmed.slice(3, endOfFm).trim();

  // Parse frontmatter lines into a record
  const fm: Record<string, string> = {};
  for (const line of fmRaw.split("\n")) {
    const sep = line.indexOf(":");
    if (sep > 0) {
      const key = line.slice(0, sep).trim();
      const value = line.slice(sep + 1).trim();
      fm[key] = value;
    }
  }

  if (!fm["finding_kind"]) return null;
  if (!fm["title"]) return null;

  return {
    finding_kind: fm["finding_kind"],
    title: fm["title"],
    severity: fm["severity"] ?? "",
    location: fm["location"] ?? "",
    metric: fm["metric"] ?? "",
    summary: fm["summary"] ?? "",
  };
}

/** Add a key:value line to the frontmatter, sanitizing newlines. */
function addHeadField(lines: string[], key: string, value: string): void {
  const safe = value.replace(/\n/g, " ").trim();
  lines.push(`${key}: ${safe}`);
}
