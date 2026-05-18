import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { analyzeProject } from "../index";

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
const GROUND_TRUTH_PATH = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "fixtures",
  "fixture-a-order-app",
  "ground-truth",
  "symbol-graph.expected.json"
);

interface GroundTruth {
  symbols: { id: string }[];
  calls: { callerId: string; calleeId: string; callKind: string }[];
  dataAccessPoints: { symbolId: string; target: string; operation: string }[];
}

const groundTruth = JSON.parse(
  readFileSync(GROUND_TRUTH_PATH, "utf8")
) as GroundTruth;

describe("analyzeProject(fixture-a backend)", () => {
  const { graph } = analyzeProject(FIXTURE_ROOT);

  it("emits a schema-versioned SymbolGraph with TypeScript + Express + Prisma identified", () => {
    expect(graph.schemaVersion).toBe("0.1.0");
    expect(graph.languages).toContain("typescript");
    const frameworkNames = graph.frameworks.map((f) => f.name);
    expect(frameworkNames).toContain("express");
    expect(frameworkNames).toContain("prisma");
  });

  it("recovers at least 80% of expected symbols (and ideally all)", () => {
    const expected = new Set(groundTruth.symbols.map((s) => s.id));
    const actual = new Set(graph.symbols.map((s) => s.id));
    const intersect = [...expected].filter((id) => actual.has(id));
    const recall = intersect.length / expected.size;
    expect(recall).toBeGreaterThanOrEqual(0.8);

    const missing = [...expected].filter((id) => !actual.has(id));
    if (missing.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(`[recall ${(recall * 100).toFixed(0)}%] missing symbols:`, missing);
    }
  });

  it("recovers at least 80% of expected calls (caller -> callee pairs)", () => {
    const expectedPairs = new Set(
      groundTruth.calls.map((c) => `${c.callerId}->${c.calleeId}`)
    );
    const actualPairs = new Set(
      graph.calls.map((c) => `${c.callerId}->${c.calleeId}`)
    );
    const intersect = [...expectedPairs].filter((p) => actualPairs.has(p));
    const recall = intersect.length / expectedPairs.size;
    expect(recall).toBeGreaterThanOrEqual(0.8);
  });

  it("identifies every expected dataAccessPoint (Prisma orm-call)", () => {
    const expectedKeys = new Set(
      groundTruth.dataAccessPoints.map(
        (d) => `${d.symbolId}|${d.target}|${d.operation}`
      )
    );
    const actualKeys = new Set(
      graph.dataAccessPoints.map(
        (d) => `${d.symbolId}|${d.target}|${d.operation}`
      )
    );
    const missing = [...expectedKeys].filter((k) => !actualKeys.has(k));
    expect(missing).toEqual([]);
  });

  it("identifies route-registration framework points for all 4 router handlers", () => {
    const handlerRouteRegs = graph.frameworkPoints.filter(
      (p) =>
        p.meaning === "route-registration" &&
        p.symbolId.startsWith("ts:src/routes/orders.ts#ordersRouter.")
    );
    expect(handlerRouteRegs.length).toBe(4);
  });

  it("identifies the router-mount in createApp", () => {
    const mounts = graph.frameworkPoints.filter(
      (p) => p.meaning === "router-mount"
    );
    expect(mounts.length).toBeGreaterThanOrEqual(1);
    expect(mounts[0].raw).toContain("/api/orders");
    expect(mounts[0].raw).toContain("ordersRouter");
  });

  it("classifies requireUser as a middleware definition", () => {
    const mwDefs = graph.frameworkPoints.filter(
      (p) =>
        p.meaning === "middleware-definition" &&
        p.symbolId === "ts:src/lib/auth.ts#requireUser"
    );
    expect(mwDefs.length).toBe(1);
  });
});
