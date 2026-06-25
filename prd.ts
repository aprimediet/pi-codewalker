import * as fs from "node:fs";
import * as path from "node:path";

const PRD_CANDIDATES = [
  "docs/PRD.md",
  "docs/prd.md",
  "PRD.md",
  ".pi/prd.md",
  "PRODUCT.md",
  "SPEC.md",
];

export function findExistingPRD(root: string): string | null {
  for (const p of PRD_CANDIDATES) {
    const filePath = path.join(root, p);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }

  // README with a goals/requirements heading
  const readme = path.join(root, "README.md");
  if (fs.existsSync(readme)) {
    try {
      const text = fs.readFileSync(readme, "utf-8");
      if (/^##\s+(Goals|Non-Goals|Requirements|Product Requirements)/im.test(text)) {
        return readme;
      }
    } catch {
      // Ignore read errors
    }
  }

  return null;
}

export function readPRD(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

export function createPRD(root: string, content: string): string {
  const outPath = path.join(root, "docs", "PRD.md");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, content, "utf-8");
  return outPath;
}

export function prdTemplate(p: {
  projectName: string;
  overview: string;
  problem: string;
  goals: string[];
  nonGoals: string[];
  targetUsers: string;
  keyFeatures: Array<{ name: string; description: string }>;
  successMetrics: string[];
  boundaries: string;
  openQuestions: string[];
  date: string;
}): string {
  const goalsSection = p.goals.map((g) => `- ${g}`).join("\n");
  const nonGoalsSection = p.nonGoals.map((g) => `- ${g}`).join("\n");
  const featuresSection = p.keyFeatures
    .map((f) => `### ${f.name}\n${f.description}`)
    .join("\n\n");
  const metricsSection = p.successMetrics.map((m) => `- ${m}`).join("\n");
  const questionsSection = p.openQuestions.map((q) => `- ${q}`).join("\n");

  return `# Product Requirements Document: ${p.projectName}

**Version:** 1.0
**Date:** ${p.date}
**Status:** Draft

## Overview
${p.overview}

## Problem Statement
${p.problem}

## Goals
${goalsSection}

## Non-Goals
${nonGoalsSection}

## Target Users
${p.targetUsers}

## Key Features
${featuresSection}

## Success Metrics
${metricsSection}

## Boundaries & Constraints
${p.boundaries}

## Open Questions
${questionsSection}
`;
}
