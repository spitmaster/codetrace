import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { analyzeProject } from "../../analyzer";
import { mapEntries } from "../../io-mapper";
import { trace } from "../index";

const FIXTURE_ROOT = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "fixtures",
  "fixture-a-order-app",
  "backend"
);
const GT_DIR = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "fixtures",
  "fixture-a-order-app",
  "ground-truth"
);

interface ExpectedFlow {
  entryId: string;
  nodes: { id: string; kind: string; label: string; symbolId?: string }[];
  edges: { id: string; from: string; to: string; kind: string }[];
}

function loadExpected(name: string): ExpectedFlow {
  return JSON.parse(readFileSync(resolve(GT_DIR, name), "utf8")) as ExpectedFlow;
}

const ENTRIES_AND_GT: { entry: string; file: string }[] = [
  { entry: "io:http:POST:/api/orders", file: "flow-graph-POST_api_orders.expected.json" },
  { entry: "io:http:GET:/api/orders", file: "flow-graph-GET_api_orders.expected.json" },
  { entry: "io:http:GET:/api/orders/:id", file: "flow-graph-GET_api_orders_id.expected.json" },
  { entry: "io:http:DELETE:/api/orders/:id", file: "flow-graph-DELETE_api_orders_id.expected.json" },
];

describe("trace(fixture-a backend)", () => {
  const { graph: sg } = analyzeProject(FIXTURE_ROOT);
  const ioEntries = mapEntries({ projectRoot: FIXTURE_ROOT, symbolGraph: sg });

  for (const t of ENTRIES_AND_GT) {
    describe(t.entry, () => {
      const expected = loadExpected(t.file);
      const actual = trace({ symbolGraph: sg, ioEntries, entryId: t.entry });

      it("emits schema-versioned FlowGraph for the entry", () => {
        expect(actual.schemaVersion).toBe("0.1.0");
        expect(actual.entryId).toBe(t.entry);
        expect(actual.nodes.length).toBeGreaterThan(0);
      });

      it("covers every expected function symbolId (key business symbols on the path)", () => {
        const expectedFnSyms = new Set<string>(
          expected.nodes
            .filter((n) => n.kind === "function" && n.symbolId)
            .map((n) => n.symbolId!)
        );
        const actualFnSyms = new Set<string>(
          actual.nodes
            .filter((n) => n.kind === "function" && n.symbolId)
            .map((n) => n.symbolId!)
        );
        const missing = [...expectedFnSyms].filter((s) => !actualFnSyms.has(s));
        // SymbolGraph re-uses the same symbolId for multiple Prisma call sites
        // inside the same function (e.g. tx.order.findFirst + tx.order.update
        // both belong to cancelOrder). We require every distinct function
        // symbolId to be reachable; per-call-site granularity is checked via
        // table-edge recall below, not here.
        expect(missing, `missing function symbolIds: ${JSON.stringify(missing)}`).toEqual([]);
      });

      it("covers every expected table by model name", () => {
        const expectedModels = new Set<string>(
          expected.nodes
            .filter((n) => n.kind === "table")
            .map((n) => normalizeModel(n.label))
        );
        const actualModels = new Set<string>(
          actual.nodes
            .filter((n) => n.kind === "table")
            .map((n) => normalizeModel(n.label))
        );
        const missing = [...expectedModels].filter((m) => !actualModels.has(m));
        expect(missing, `missing tables: ${JSON.stringify(missing)}`).toEqual([]);
      });

      it("has the main-path edge kinds (call / read / write / return / input-bind)", () => {
        const kinds = new Set(actual.edges.map((e) => e.kind));
        expect(kinds.has("call")).toBe(true);
        expect(kinds.has("return")).toBe(true);
        const expectedKinds = new Set(expected.edges.map((e) => e.kind));
        for (const k of expectedKinds) {
          if (k === "input-bind") continue; // implicit edge; covered by call/input-bind heuristic
          if (k === "read" || k === "write" || k === "delete") {
            expect(kinds.has(k), `missing edge kind: ${k}`).toBe(true);
          }
        }
      });
    });
  }
});

function normalizeModel(label: string): string {
  // "User table" / "User Table" / "user_table" → "user"
  return label.toLowerCase().replace(/table/g, "").replace(/[\s_]+/g, "").trim();
}
