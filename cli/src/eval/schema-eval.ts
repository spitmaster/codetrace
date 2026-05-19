/**
 * Coverage evaluators for the upstream intermediate representations
 * (SymbolGraph / IOEntryRegistry / FlowGraph). Used by the e2e regression
 * script to roll up SPEC §7 accuracy numbers.
 *
 * Each evaluator returns a small report struct so the caller (e2e script)
 * can format markdown without re-deriving things.
 */
import {
  SymbolGraph,
  IOEntryRegistry,
  FlowGraph,
} from "../schemas";

export interface SymbolGraphReport {
  expectedSymbols: number;
  matchedSymbols: number;
  recall: number;
  // names that were expected but missing from candidate
  missing: string[];
}

export function evaluateSymbolGraph(
  gt: SymbolGraph,
  cand: SymbolGraph
): SymbolGraphReport {
  const candIds = new Set(cand.symbols.map((s) => s.id));
  const expected = gt.symbols.length;
  let matched = 0;
  const missing: string[] = [];
  for (const sym of gt.symbols) {
    if (candIds.has(sym.id)) matched++;
    else missing.push(sym.id);
  }
  return {
    expectedSymbols: expected,
    matchedSymbols: matched,
    recall: expected ? matched / expected : 1,
    missing,
  };
}

export interface IOEntryReport {
  expectedEntries: number;
  matchedEntries: number;
  accuracy: number;
  // entryId  → ground-truth that was missing from candidate
  missing: string[];
  // candidate-only entries (extras) — should be 0 for 100% accuracy
  extras: string[];
  // field-level mismatches (per entry)
  fieldMismatches: Array<{ entryId: string; field: string; gt: unknown; cand: unknown }>;
}

export function evaluateIOEntryRegistry(
  gt: IOEntryRegistry,
  cand: IOEntryRegistry
): IOEntryReport {
  const gtById = new Map(gt.entries.map((e) => [e.id, e]));
  const candById = new Map(cand.entries.map((e) => [e.id, e]));
  let matched = 0;
  const missing: string[] = [];
  const fieldMismatches: IOEntryReport["fieldMismatches"] = [];
  for (const [id, g] of gtById) {
    const c = candById.get(id);
    if (!c) {
      missing.push(id);
      continue;
    }
    matched++;
    // Field-level strict equality on the SPEC-critical fields.
    if (g.displayName !== c.displayName)
      fieldMismatches.push({ entryId: id, field: "displayName", gt: g.displayName, cand: c.displayName });
    if (g.handlerSymbolId !== c.handlerSymbolId)
      fieldMismatches.push({
        entryId: id,
        field: "handlerSymbolId",
        gt: g.handlerSymbolId,
        cand: c.handlerSymbolId,
      });
    const gtMw = (g.middlewareSymbolIds ?? []).slice().sort().join(",");
    const candMw = (c.middlewareSymbolIds ?? []).slice().sort().join(",");
    if (gtMw !== candMw)
      fieldMismatches.push({
        entryId: id,
        field: "middlewareSymbolIds",
        gt: g.middlewareSymbolIds,
        cand: c.middlewareSymbolIds,
      });
    if (g.confidence !== c.confidence)
      fieldMismatches.push({ entryId: id, field: "confidence", gt: g.confidence, cand: c.confidence });
  }
  const extras: string[] = [];
  for (const id of candById.keys()) if (!gtById.has(id)) extras.push(id);
  return {
    expectedEntries: gtById.size,
    matchedEntries: matched,
    accuracy: gtById.size ? matched / gtById.size : 1,
    missing,
    extras,
    fieldMismatches,
  };
}

export interface FlowGraphReport {
  entryId: string;
  gtNodes: number;
  candNodes: number;
  matchedNodes: number;
  gtEdges: number;
  candEdges: number;
  matchedEdges: number;
  nodeCoverage: number;
  edgeCoverage: number;
  // Critical-path table reads/writes covered? (count of write/delete/read
  // edges whose target table appears in candidate)
  writeReadTableCoverage: number;
}

/**
 * Build a stable semantic key for a FlowGraph node — used to compare GT and
 * candidate without relying on accidentally-aligned numeric IDs.
 *
 * Why: the tracer assigns n1, n2, ... in traversal order; the ground-truth
 * uses curated IDs. They MIGHT coincide on simple flows but we should not
 * depend on that.
 */
function nodeSemKey(n: FlowGraph["nodes"][number]): string {
  const m = (n.metadata ?? {}) as Record<string, unknown>;
  if (typeof m.ormCall === "string") return `orm:${(m.ormCall as string).toLowerCase()}`;
  if (typeof m.model === "string") return `table:${m.model}`;
  if (n.symbolId) return `sym:${n.symbolId}`;
  if (n.kind === "input") return "input";
  if (n.kind === "response") return `response:${n.kind}`;
  return `label:${n.label}`;
}
/**
 * Edge match strategy:
 *   - read/write/delete edges: match on (kind, target-table) — these are the
 *     "what-touches-which-table" facts we really care about for SPEC §7. The
 *     tracer may legitimately produce them via an extra function node (e.g.
 *     expanding a Prisma `include` into a separate findFirst call) while GT
 *     wires the read edge directly from the orchestrator function. Both
 *     phrasings describe the same business fact.
 *   - call/return/input-bind: match on (kind, fromKey, toKey).
 *
 * Note: this is deliberately permissive on the call path because tracer node
 * granularity is allowed to be FINER than GT — strict node-by-node lockstep
 * isn't a SPEC goal.
 */
function edgeSemKeys(
  e: FlowGraph["edges"][number],
  nodeKeyById: Map<string, string>
): string[] {
  const m = (e.metadata ?? {}) as Record<string, unknown>;
  const fromK = nodeKeyById.get(e.from) ?? e.from;
  const toK = nodeKeyById.get(e.to) ?? e.to;
  if (["read", "write", "delete"].includes(e.kind)) {
    const tgt = typeof m.target === "string" ? m.target : "";
    return [`tableop|${e.kind}|${tgt}`];
  }
  return [`${e.kind}|${fromK}|${toK}`];
}

export function evaluateFlowGraph(
  gt: FlowGraph,
  cand: FlowGraph
): FlowGraphReport {
  const gtKeyById = new Map(gt.nodes.map((n) => [n.id, nodeSemKey(n)] as const));
  const candKeyById = new Map(cand.nodes.map((n) => [n.id, nodeSemKey(n)] as const));
  const candKeys = new Set(candKeyById.values());
  const matchedNodes = gt.nodes.filter((n) => candKeys.has(nodeSemKey(n))).length;
  const candEdgeKeys = new Set<string>();
  for (const e of cand.edges) for (const k of edgeSemKeys(e, candKeyById)) candEdgeKeys.add(k);
  const matchedEdges = gt.edges.filter((e) =>
    edgeSemKeys(e, gtKeyById).some((k) => candEdgeKeys.has(k))
  ).length;

  // Critical-path table coverage: every (write|delete|read) edge in gt has a
  // candidate edge with the same `kind` AND the same metadata.target.
  const candTblOps = new Set(
    cand.edges
      .filter((e) => ["read", "write", "delete"].includes(e.kind))
      .map((e) => {
        const m = (e.metadata ?? {}) as Record<string, unknown>;
        return `${e.kind}:${typeof m.target === "string" ? m.target : ""}`;
      })
  );
  const gtTblOps = gt.edges.filter((e) => ["read", "write", "delete"].includes(e.kind));
  const tblMatched = gtTblOps.filter((e) => {
    const m = (e.metadata ?? {}) as Record<string, unknown>;
    return candTblOps.has(`${e.kind}:${typeof m.target === "string" ? m.target : ""}`);
  }).length;
  const writeReadTableCoverage = gtTblOps.length ? tblMatched / gtTblOps.length : 1;

  return {
    entryId: gt.entryId,
    gtNodes: gt.nodes.length,
    candNodes: cand.nodes.length,
    matchedNodes,
    gtEdges: gt.edges.length,
    candEdges: cand.edges.length,
    matchedEdges,
    nodeCoverage: gt.nodes.length ? matchedNodes / gt.nodes.length : 1,
    edgeCoverage: gt.edges.length ? matchedEdges / gt.edges.length : 1,
    writeReadTableCoverage,
  };
}
