#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { analyzeProject } from "./analyzer";
import { mapEntries } from "./io-mapper";
import { trace } from "./tracer";

function help(): never {
  // eslint-disable-next-line no-console
  console.error(
    [
      "codeviz — M1 CLI",
      "",
      "Usage:",
      "  codeviz analyze <project-root> [--output <file>]",
      "  codeviz map-io  <project-root> [--output <file>]",
      "  codeviz trace   <project-root> --entry <entryId> [--depth-limit N] [--output <file>]",
      "",
      "Subcommands:",
      "  analyze  Run static analysis on a TS+Express+Prisma project and emit a SymbolGraph JSON.",
      "  map-io   Identify HTTP IO entries (Express routes) and emit an IOEntryRegistry JSON.",
      "  trace    Trace one IO entry into a FlowGraph (nodes + edges with confidence).",
      "",
      "Notes:",
      "  M1 supports TypeScript + Express + Prisma only (per overview red line #4).",
      "  All output is schema-versioned (schemaVersion = 0.1.0).",
    ].join("\n")
  );
  process.exit(2);
}

interface ParsedArgs {
  subcommand: string;
  projectRoot: string;
  outputFile?: string;
  entryId?: string;
  depthLimit?: number;
}

function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length < 2) help();
  const subcommand = argv[0];
  const rest = argv.slice(1);
  let projectRoot: string | undefined;
  let outputFile: string | undefined;
  let entryId: string | undefined;
  let depthLimit: number | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--output" || a === "-o") {
      outputFile = rest[++i];
      continue;
    }
    if (a === "--entry") {
      entryId = rest[++i];
      continue;
    }
    if (a === "--depth-limit") {
      depthLimit = parseInt(rest[++i], 10);
      continue;
    }
    if (a.startsWith("--")) {
      console.error(`unknown flag: ${a}`);
      help();
    }
    if (!projectRoot) projectRoot = a;
  }
  if (!projectRoot) help();
  return { subcommand, projectRoot, outputFile, entryId, depthLimit };
}

function emit(data: unknown, outputFile?: string): void {
  const text = JSON.stringify(data, null, 2);
  if (outputFile) {
    const abs = resolve(outputFile);
    writeFileSync(abs, text + "\n", "utf8");
    // eslint-disable-next-line no-console
    console.error(`wrote ${abs}`);
  } else {
    // stdout
    process.stdout.write(text + "\n");
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  switch (args.subcommand) {
    case "analyze": {
      const { graph } = analyzeProject(args.projectRoot);
      emit(graph, args.outputFile);
      return;
    }
    case "map-io": {
      const registry = mapEntries({ projectRoot: args.projectRoot });
      emit(registry, args.outputFile);
      return;
    }
    case "trace": {
      if (!args.entryId) {
        console.error("trace requires --entry <entryId>");
        help();
      }
      const { graph } = analyzeProject(args.projectRoot);
      const ioEntries = mapEntries({ projectRoot: args.projectRoot, symbolGraph: graph });
      const flow = trace({
        symbolGraph: graph,
        ioEntries,
        entryId: args.entryId!,
        depthLimit: args.depthLimit,
      });
      emit(flow, args.outputFile);
      return;
    }
    case "help":
    case "--help":
    case "-h":
      help();
    default:
      console.error(`unknown subcommand: ${args.subcommand}`);
      help();
  }
}

main();
