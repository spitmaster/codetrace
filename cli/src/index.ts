#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { analyzeProject } from "./analyzer";
import { mapEntries } from "./io-mapper";
import { trace } from "./tracer";
import { FlowGraphSchema } from "./schemas";
import {
  ClaudeProvider,
  MockProvider,
  OllamaProvider,
  translate as runTranslate,
  LLMProvider,
} from "./translator";

function help(): never {
  // eslint-disable-next-line no-console
  console.error(
    [
      "codeviz — M1 CLI",
      "",
      "Usage:",
      "  codeviz analyze   <project-root> [--output <file>]",
      "  codeviz map-io    <project-root> [--output <file>]",
      "  codeviz trace     <project-root> --entry <entryId> [--depth-limit N] [--output <file>]",
      "  codeviz translate <flow-graph.json> [--provider mock|claude|ollama] [--model <id>] [--output <file>]",
      "",
      "Subcommands:",
      "  analyze    Run static analysis on a TS+Express+Prisma project and emit a SymbolGraph JSON.",
      "  map-io     Identify HTTP IO entries (Express routes) and emit an IOEntryRegistry JSON.",
      "  trace      Trace one IO entry into a FlowGraph (nodes + edges with confidence).",
      "  translate  Translate a FlowGraph into BusinessAnnotations via the chosen LLM provider.",
      "             Default --provider mock (offline, deterministic). claude requires ANTHROPIC_API_KEY.",
      "             ollama requires a local ollama server at http://localhost:11434.",
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
  // For translate(), positional is the flow-graph.json path (NOT a project root).
  positional: string;
  outputFile?: string;
  entryId?: string;
  depthLimit?: number;
  provider?: string;
  model?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length < 2) help();
  const subcommand = argv[0];
  const rest = argv.slice(1);
  let positional: string | undefined;
  let outputFile: string | undefined;
  let entryId: string | undefined;
  let depthLimit: number | undefined;
  let provider: string | undefined;
  let model: string | undefined;
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
    if (a === "--provider") {
      provider = rest[++i];
      continue;
    }
    if (a === "--model") {
      model = rest[++i];
      continue;
    }
    if (a.startsWith("--")) {
      console.error(`unknown flag: ${a}`);
      help();
    }
    if (!positional) positional = a;
  }
  if (!positional) help();
  return { subcommand, positional, outputFile, entryId, depthLimit, provider, model };
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

function makeProvider(id: string, model?: string): LLMProvider {
  switch (id) {
    case "mock":
      return new MockProvider();
    case "claude":
      return new ClaudeProvider({ model });
    case "ollama":
      return new OllamaProvider({ model });
    default:
      throw new Error(`unknown --provider: ${id}; expected mock|claude|ollama`);
  }
}

async function runMain(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  switch (args.subcommand) {
    case "analyze": {
      const { graph } = analyzeProject(args.positional);
      emit(graph, args.outputFile);
      return;
    }
    case "map-io": {
      const registry = mapEntries({ projectRoot: args.positional });
      emit(registry, args.outputFile);
      return;
    }
    case "trace": {
      if (!args.entryId) {
        console.error("trace requires --entry <entryId>");
        help();
      }
      const { graph } = analyzeProject(args.positional);
      const ioEntries = mapEntries({ projectRoot: args.positional, symbolGraph: graph });
      const flow = trace({
        symbolGraph: graph,
        ioEntries,
        entryId: args.entryId!,
        depthLimit: args.depthLimit,
      });
      emit(flow, args.outputFile);
      return;
    }
    case "translate": {
      // Positional is a path to a FlowGraph JSON file (NOT a project root).
      const flowText = readFileSync(resolve(args.positional), "utf8");
      const flow = FlowGraphSchema.parse(JSON.parse(flowText));
      const providerId = args.provider ?? "mock";
      const provider = makeProvider(providerId, args.model);
      const annotations = await runTranslate({ provider, flow });
      emit(annotations, args.outputFile);
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

runMain().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
