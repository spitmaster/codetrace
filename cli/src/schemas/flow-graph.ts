import { z } from "zod";
import { Confidence, SchemaVersion, SymbolId } from "./common";

// FlowGraph — dataflow-tracer output (one per IO entry).
// Reference: docs/agents/codeviz-overview.md §FlowGraph

const NodeKind = z.enum([
  "function",
  "table",
  "file",
  "external-api",
  "queue",
  "response",
  "input",
]);

const EdgeKind = z.enum([
  "call",
  "read",
  "write",
  "delete",
  "publish",
  "http-call",
  "return",
  "input-bind",
]);

const Node = z
  .object({
    id: z.string().min(1),
    kind: NodeKind,
    label: z.string().min(1),
    symbolId: SymbolId.optional(), // tables/files/responses may have no symbol
    depth: z.number().int().nonnegative(),
    metadata: z.record(z.unknown()).optional(),
  })
  .passthrough();

const Edge = z
  .object({
    id: z.string().min(1),
    from: z.string().min(1),
    to: z.string().min(1),
    kind: EdgeKind,
    confidence: Confidence,
    metadata: z.record(z.unknown()).optional(),
  })
  .passthrough();

const Truncation = z
  .object({
    at: z.string().min(1),
    reason: z.string().min(1),
  })
  .passthrough();

export const FlowGraphSchema = z
  .object({
    schemaVersion: SchemaVersion,
    entryId: z.string().min(1),
    nodes: z.array(Node).min(1),
    edges: z.array(Edge),
    cycles: z.array(z.array(z.string().min(1))).default([]),
    truncations: z.array(Truncation).default([]),
  })
  .passthrough()
  .superRefine((g, ctx) => {
    const nodeIds = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) {
      if (!nodeIds.has(e.from)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `edge ${e.id}: from-node "${e.from}" not found in nodes[]`,
        });
      }
      if (!nodeIds.has(e.to)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `edge ${e.id}: to-node "${e.to}" not found in nodes[]`,
        });
      }
    }
  });

export type FlowGraph = z.infer<typeof FlowGraphSchema>;
