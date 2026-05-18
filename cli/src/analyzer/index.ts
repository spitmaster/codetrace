import { existsSync, readFileSync } from "node:fs";
import { resolve, sep, posix, relative } from "node:path";
import { Project } from "ts-morph";

import { SymbolGraph, SymbolGraphSchema, SCHEMA_VERSION } from "../schemas";

import {
  collectHandlerSymbols,
  extractSymbolsAndHandlers,
} from "./symbols";
import { extractFrameworkPoints } from "./framework-points";
import { extractCalls } from "./calls";
import { extractDataAccess } from "./data-access";
import { AnalyzeOptions } from "./types";

export interface AnalyzeResult {
  graph: SymbolGraph;
}

const DEFAULT_INCLUDE = ["src/**/*.ts"];
const DEFAULT_EXCLUDE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/*.d.ts",
  "**/*.test.ts",
  "**/*.spec.ts",
];

export function analyzeProject(
  projectRoot: string,
  opts: AnalyzeOptions = {}
): AnalyzeResult {
  const absRoot = resolve(projectRoot);
  if (!existsSync(absRoot)) {
    throw new Error(`project root does not exist: ${absRoot}`);
  }
  const normalizedRoot = absRoot.split(sep).join(posix.sep);

  const tsconfigPath = resolve(absRoot, "tsconfig.json");
  const project = existsSync(tsconfigPath)
    ? new Project({ tsConfigFilePath: tsconfigPath, skipAddingFilesFromTsConfig: true })
    : new Project();

  const include = opts.includeGlobs ?? DEFAULT_INCLUDE;
  const exclude = opts.excludeGlobs ?? DEFAULT_EXCLUDE;
  const cwdAbs = absRoot;
  for (const pattern of include) {
    project.addSourceFilesAtPaths(
      [posix.join(normalizedRoot, pattern), ...exclude.map((p) => `!${posix.join(normalizedRoot, p)}`)]
    );
  }

  if (project.getSourceFiles().length === 0) {
    throw new Error(
      `analyzer found no .ts source files under ${absRoot}/src — nothing to do`
    );
  }

  const { symbols, handlers } = extractSymbolsAndHandlers(project, normalizedRoot);

  const handlerSymbols = collectHandlerSymbols(handlers);
  for (const hs of handlerSymbols) {
    if (!symbols.find((s) => s.id === hs.id)) {
      symbols.push(hs);
    }
  }

  const { points: frameworkPoints } = extractFrameworkPoints(project, normalizedRoot, handlers);
  const calls = extractCalls(project, normalizedRoot, handlers);
  const dataAccessPoints = extractDataAccess(project, normalizedRoot);

  const frameworks = detectFrameworks(absRoot);

  // Build the graph as `unknown`-shaped data and let zod's .parse() be the
  // gatekeeper. The inferred SymbolGraph type carries an index signature
  // (from passthrough()), which our narrow local record types don't have —
  // an inconsequential mismatch at compile time, fully resolved by .parse().
  const graph = SymbolGraphSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    rootPath: relative(process.cwd(), absRoot).split(sep).join(posix.sep) || absRoot,
    languages: ["typescript"],
    frameworks,
    symbols,
    calls,
    frameworkPoints,
    dataAccessPoints,
  });

  void cwdAbs;
  return { graph };
}

function detectFrameworks(absRoot: string): { name: string; version?: string; confidence: "high" | "medium" | "low" }[] {
  const out: { name: string; version?: string; confidence: "high" | "medium" | "low" }[] = [];
  const pkgPath = resolve(absRoot, "package.json");
  if (!existsSync(pkgPath)) return out;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    if ("express" in deps) {
      out.push({
        name: "express",
        version: simplifyVersion(deps.express),
        confidence: "high",
      });
    }
    if ("@prisma/client" in deps || "prisma" in deps) {
      out.push({
        name: "prisma",
        version: simplifyVersion(deps["@prisma/client"] ?? deps.prisma),
        confidence: "high",
      });
    }
  } catch {
    // best-effort
  }
  return out;
}

function simplifyVersion(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const m = v.match(/(\d+)\.x|\^?(\d+)\./);
  if (m) {
    const major = m[1] ?? m[2];
    return `${major}.x`;
  }
  return v;
}

export { extractSymbolsAndHandlers, extractCalls, extractDataAccess, extractFrameworkPoints };
