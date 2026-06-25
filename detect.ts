import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

export interface TechStack {
  primary: string[];
  frameworks: string[];
  infrastructure: string[];
  packageManagers: string[];
}

export interface TechIssue {
  severity: "error" | "warning" | "info";
  location: string;
  message: string;
}

export interface ProjectStatus {
  recentCommits: string;
  hasChangelog: boolean;
  todoCount: number;
}

const LANG_FILES: Array<{ file: string; lang: string }> = [
  { file: "package.json", lang: "Node.js" },
  { file: "tsconfig.json", lang: "TypeScript" },
  { file: "requirements.txt", lang: "Python" },
  { file: "pyproject.toml", lang: "Python" },
  { file: "go.mod", lang: "Go" },
  { file: "Cargo.toml", lang: "Rust" },
  { file: "pom.xml", lang: "Java" },
  { file: "build.gradle", lang: "Java/Kotlin" },
  { file: "build.gradle.kts", lang: "Kotlin" },
  { file: "Gemfile", lang: "Ruby" },
  { file: "composer.json", lang: "PHP" },
  { file: "mix.exs", lang: "Elixir" },
];

const FRAMEWORK_FILES: Array<{ file: string; name: string; infra?: boolean }> = [
  { file: "next.config.js", name: "Next.js" },
  { file: "next.config.ts", name: "Next.js" },
  { file: "next.config.mjs", name: "Next.js" },
  { file: "vite.config.ts", name: "Vite" },
  { file: "vite.config.js", name: "Vite" },
  { file: "nuxt.config.ts", name: "Nuxt.js" },
  { file: "svelte.config.js", name: "SvelteKit" },
  { file: "astro.config.mjs", name: "Astro" },
  { file: "remix.config.js", name: "Remix" },
  { file: "angular.json", name: "Angular" },
  { file: "tailwind.config.ts", name: "Tailwind CSS" },
  { file: "tailwind.config.js", name: "Tailwind CSS" },
  { file: "biome.json", name: "Biome" },
  { file: "Dockerfile", name: "Docker", infra: true },
  { file: "docker-compose.yml", name: "Docker Compose", infra: true },
  { file: ".github/workflows", name: "GitHub Actions", infra: true },
  { file: ".gitlab-ci.yml", name: "GitLab CI", infra: true },
];

const NPM_FRAMEWORKS: Record<string, string> = {
  react: "React",
  vue: "Vue",
  express: "Express",
  fastify: "Fastify",
  hono: "Hono",
  "@nestjs/core": "NestJS",
  prisma: "Prisma",
  "@prisma/client": "Prisma",
  "drizzle-orm": "Drizzle ORM",
  "@trpc/server": "tRPC",
};

export function detectTechStack(root: string): TechStack {
  const primary = new Set<string>();
  const frameworks = new Set<string>();
  const infrastructure = new Set<string>();
  const packageManagers = new Set<string>();

  for (const d of LANG_FILES) {
    if (fs.existsSync(path.join(root, d.file))) primary.add(d.lang);
  }

  for (const d of FRAMEWORK_FILES) {
    if (fs.existsSync(path.join(root, d.file))) {
      if (d.infra) infrastructure.add(d.name);
      else frameworks.add(d.name);
    }
  }

  if (fs.existsSync(path.join(root, "package-lock.json"))) packageManagers.add("npm");
  if (fs.existsSync(path.join(root, "yarn.lock"))) packageManagers.add("yarn");
  if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) packageManagers.add("pnpm");
  if (fs.existsSync(path.join(root, "bun.lock"))) packageManagers.add("bun");

  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    for (const [dep, label] of Object.entries(NPM_FRAMEWORKS)) {
      if (dep in deps) frameworks.add(label);
    }
  } catch {
    /***/
  }

  return {
    primary: [...primary],
    frameworks: [...frameworks],
    infrastructure: [...infrastructure],
    packageManagers: [...packageManagers],
  };
}

export function detectProjectStatus(root: string): ProjectStatus {
  let recentCommits = "";
  try {
    recentCommits = execSync("git log --oneline -20", {
      cwd: root,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
    recentCommits = "(git not available or no commits)";
  }

  const hasChangelog =
    fs.existsSync(path.join(root, "CHANGELOG.md")) || fs.existsSync(path.join(root, "CHANGELOG"));

  let todoCount = 0;
  try {
    const result = execSync(
      `grep -r --include="*.ts" --include="*.tsx" --include="*.js" --include="*.py" --include="*.go" --include="*.rs" -c "TODO:\\|FIXME:\\|HACK:\\|BUG:" . 2>/dev/null || true`,
      { cwd: root, encoding: "utf-8", timeout: 10000 }
    );
    for (const line of result.split("\n")) {
      const m = line.match(/:(\d+)$/);
      if (m) todoCount += parseInt(m[1], 10);
    }
  } catch {
    /***/
  }

  return { recentCommits, hasChangelog, todoCount };
}

export function detectTechnicalIssues(root: string): TechIssue[] {
  const issues: TechIssue[] = [];

  // Invalid tsconfig.json
  const tsconfigPath = path.join(root, "tsconfig.json");
  if (fs.existsSync(tsconfigPath)) {
    try {
      JSON.parse(fs.readFileSync(tsconfigPath, "utf-8"));
    } catch (e) {
      issues.push({
        severity: "error",
        location: "tsconfig.json",
        message: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  // No test directory or config
  const testDirs = ["test", "tests", "__tests__", "spec"];
  const testConfigs = ["vitest.config.ts", "vitest.config.js", "jest.config.ts", "jest.config.js"];
  const hasTests =
    testDirs.some((d) => fs.existsSync(path.join(root, d))) ||
    testConfigs.some((f) => fs.existsSync(path.join(root, f)));
  if (!hasTests) {
    issues.push({
      severity: "warning",
      location: "root",
      message: "No test directory or test config detected",
    });
  }

  // .env.example without .env
  if (
    fs.existsSync(path.join(root, ".env.example")) &&
    !fs.existsSync(path.join(root, ".env"))
  ) {
    issues.push({
      severity: "info",
      location: ".env",
      message: ".env.example exists but .env is missing — check environment setup",
    });
  }

  return issues;
}
