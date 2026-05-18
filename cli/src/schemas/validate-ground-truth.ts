#!/usr/bin/env node
/**
 * Run from cli/: `npm run validate:ground-truth`
 *
 * Validates the four M1.1 ground-truth files in
 * fixtures/fixture-a-order-app/ground-truth/ against the zod schemas.
 *
 * Exit code:
 *   0 — all files valid
 *   1 — any file invalid (errors printed to stderr)
 *
 * This is M1.1's structural gate before agents start producing equivalent
 * JSON in M1.2 – M1.5: if ground-truth doesn't fit the schema, the schema
 * is wrong; if a M1.2 analyzer's output doesn't fit, the analyzer is wrong.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

import {
  BusinessAnnotationsSchema,
  FlowGraphSchema,
  IOEntryRegistrySchema,
  SymbolGraphSchema,
} from "./index";

interface Target {
  label: string;
  path: string;
  schema: z.ZodTypeAny;
}

const repoRoot = resolve(__dirname, "..", "..", "..");
const gtDir = resolve(
  repoRoot,
  "fixtures",
  "fixture-a-order-app",
  "ground-truth"
);

const targets: Target[] = [
  {
    label: "SymbolGraph",
    path: resolve(gtDir, "symbol-graph.expected.json"),
    schema: SymbolGraphSchema,
  },
  {
    label: "IOEntryRegistry",
    path: resolve(gtDir, "io-entry-registry.expected.json"),
    schema: IOEntryRegistrySchema,
  },
  {
    label: "FlowGraph (POST /api/orders)",
    path: resolve(gtDir, "flow-graph-POST_api_orders.expected.json"),
    schema: FlowGraphSchema,
  },
  {
    label: "BusinessAnnotations (POST /api/orders)",
    path: resolve(gtDir, "business-annotations-POST_api_orders.expected.json"),
    schema: BusinessAnnotationsSchema,
  },
];

let hadFailure = false;
for (const t of targets) {
  let raw: string;
  try {
    raw = readFileSync(t.path, "utf8");
  } catch (err) {
    console.error(`✗ ${t.label}: cannot read ${t.path}`);
    console.error(`  ${(err as Error).message}`);
    hadFailure = true;
    continue;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`✗ ${t.label}: invalid JSON in ${t.path}`);
    console.error(`  ${(err as Error).message}`);
    hadFailure = true;
    continue;
  }

  const result = t.schema.safeParse(parsed);
  if (result.success) {
    console.log(`✓ ${t.label} — ${t.path}`);
  } else {
    hadFailure = true;
    console.error(`✗ ${t.label} — ${t.path}`);
    for (const issue of result.error.issues) {
      const where = issue.path.length ? issue.path.join(".") : "<root>";
      console.error(`  • ${where}: ${issue.message}`);
    }
  }
}

if (hadFailure) {
  console.error("");
  console.error("Some ground-truth files failed validation.");
  process.exit(1);
}
console.log("");
console.log("All ground-truth files structurally valid.");
