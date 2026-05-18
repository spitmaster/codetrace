import {
  FlowGraph,
  FlowGraphSchema,
  IOEntryRegistry,
  SCHEMA_VERSION,
  SymbolGraph,
} from "../schemas";

export interface TraceOptions {
  symbolGraph: SymbolGraph;
  ioEntries: IOEntryRegistry;
  entryId: string;
  depthLimit?: number;
}

interface NodeRecord {
  id: string;
  kind: FlowGraph["nodes"][number]["kind"];
  label: string;
  symbolId?: string;
  depth: number;
  metadata?: Record<string, unknown>;
}

interface EdgeRecord {
  id: string;
  from: string;
  to: string;
  kind: FlowGraph["edges"][number]["kind"];
  confidence: "high" | "medium" | "low";
  metadata?: Record<string, unknown>;
}

const DEFAULT_DEPTH_LIMIT = 10;

export function trace(opts: TraceOptions): FlowGraph {
  const entry = opts.ioEntries.entries.find((e) => e.id === opts.entryId);
  if (!entry) {
    throw new Error(`unknown entry: ${opts.entryId}`);
  }
  const depthLimit = opts.depthLimit ?? DEFAULT_DEPTH_LIMIT;

  const nodes: NodeRecord[] = [];
  const edges: EdgeRecord[] = [];
  const truncations: { at: string; reason: string }[] = [];
  const cycles: string[][] = [];

  const callsByCaller = new Map<string, SymbolGraph["calls"]>();
  for (const c of opts.symbolGraph.calls) {
    const arr = callsByCaller.get(c.callerId);
    if (arr) arr.push(c);
    else callsByCaller.set(c.callerId, [c]);
  }

  const dataAccessBySymbol = new Map<string, SymbolGraph["dataAccessPoints"]>();
  for (const d of opts.symbolGraph.dataAccessPoints) {
    const arr = dataAccessBySymbol.get(d.symbolId);
    if (arr) arr.push(d);
    else dataAccessBySymbol.set(d.symbolId, [d]);
  }

  let nodeSeq = 0;
  const nodeIdForSymbol = new Map<string, string>(); // symbolId → nodeId
  const nodeIdForTable = new Map<string, string>(); // tableName → nodeId

  function nextNodeId(): string {
    return `n${++nodeSeq}`;
  }
  let edgeSeq = 0;
  function nextEdgeId(): string {
    return `e${++edgeSeq}`;
  }

  // 1) input node
  const inputNode: NodeRecord = {
    id: nextNodeId(),
    kind: "input",
    label: "request",
    depth: 0,
    metadata: extractInputMetadata(entry),
  };
  nodes.push(inputNode);

  // 2) middleware node(s) at depth=1
  const mwNodeIds: string[] = [];
  for (const mwSymId of entry.middlewareSymbolIds ?? []) {
    const id = nextNodeId();
    nodeIdForSymbol.set(mwSymId, id);
    const sym = opts.symbolGraph.symbols.find((s) => s.id === mwSymId);
    nodes.push({
      id,
      kind: "function",
      label: sym?.name ?? mwSymId,
      symbolId: mwSymId,
      depth: 1,
      metadata: { role: "middleware" },
    });
    mwNodeIds.push(id);
    edges.push({
      id: nextEdgeId(),
      from: inputNode.id,
      to: id,
      kind: "input-bind",
      confidence: "high",
    });
  }

  // 3) handler node at depth=1
  const handlerNodeId = nextNodeId();
  nodeIdForSymbol.set(entry.handlerSymbolId, handlerNodeId);
  const handlerSym = opts.symbolGraph.symbols.find((s) => s.id === entry.handlerSymbolId);
  nodes.push({
    id: handlerNodeId,
    kind: "function",
    label: handlerLabel(entry),
    symbolId: entry.handlerSymbolId,
    depth: 1,
    metadata: handlerSym ? { kind: handlerSym.kind } : undefined,
  });
  for (const mwId of mwNodeIds) {
    edges.push({
      id: nextEdgeId(),
      from: mwId,
      to: handlerNodeId,
      kind: "call",
      confidence: "high",
    });
  }
  if (mwNodeIds.length === 0) {
    edges.push({
      id: nextEdgeId(),
      from: inputNode.id,
      to: handlerNodeId,
      kind: "input-bind",
      confidence: "high",
    });
  }

  // 4) DFS from handler over calls, attach data access edges.
  const visiting = new Set<string>();
  function dfs(symbolId: string, depth: number, fromNodeId: string): void {
    if (depth > depthLimit) {
      truncations.push({ at: symbolId, reason: `depth limit ${depthLimit} reached` });
      return;
    }
    if (visiting.has(symbolId)) {
      cycles.push([...visiting, symbolId]);
      return;
    }
    visiting.add(symbolId);

    const dataAccess = dataAccessBySymbol.get(symbolId) ?? [];
    for (const da of dataAccess) {
      const opNodeId = nextNodeId();
      nodes.push({
        id: opNodeId,
        kind: "function",
        label: prismaCallLabel(da),
        symbolId,
        depth: depth + 1,
        metadata: {
          ormCall: `prisma.${da.target.toLowerCase()}.${prismaOpFromRaw(da.raw ?? "")}`,
          site: da.fileLocation,
          operation: da.operation,
        },
      });
      edges.push({
        id: nextEdgeId(),
        from: fromNodeId,
        to: opNodeId,
        kind: "call",
        confidence: "high",
        metadata: { site: da.fileLocation },
      });

      let tableNodeId = nodeIdForTable.get(da.target);
      if (!tableNodeId) {
        tableNodeId = nextNodeId();
        nodeIdForTable.set(da.target, tableNodeId);
        nodes.push({
          id: tableNodeId,
          kind: "table",
          label: `${da.target} table`,
          depth: depth + 2,
          metadata: { model: da.target },
        });
      }
      edges.push({
        id: nextEdgeId(),
        from: opNodeId,
        to: tableNodeId,
        kind: da.operation === "delete" ? "delete" : da.operation,
        confidence: "high",
        metadata: { target: da.target },
      });
    }

    const outgoing = callsByCaller.get(symbolId) ?? [];
    for (const call of outgoing) {
      if (call.callKind === "framework-injected") continue;
      let calleeNodeId = nodeIdForSymbol.get(call.calleeId);
      if (!calleeNodeId) {
        const calleeSym = opts.symbolGraph.symbols.find((s) => s.id === call.calleeId);
        if (!calleeSym) continue;
        calleeNodeId = nextNodeId();
        nodeIdForSymbol.set(call.calleeId, calleeNodeId);
        nodes.push({
          id: calleeNodeId,
          kind: "function",
          label: calleeSym.name,
          symbolId: call.calleeId,
          depth: depth + 1,
          metadata: { kind: calleeSym.kind },
        });
        edges.push({
          id: nextEdgeId(),
          from: fromNodeId,
          to: calleeNodeId,
          kind: "call",
          confidence: call.confidence,
          metadata: { site: call.fileLocation },
        });
        dfs(call.calleeId, depth + 1, calleeNodeId);
      } else {
        // already visited this callee; just add an edge to it
        edges.push({
          id: nextEdgeId(),
          from: fromNodeId,
          to: calleeNodeId,
          kind: "call",
          confidence: call.confidence,
          metadata: { site: call.fileLocation, revisit: true },
        });
      }
    }

    visiting.delete(symbolId);
  }
  dfs(entry.handlerSymbolId, 1, handlerNodeId);

  // 5) response node
  const responseNodeId = nextNodeId();
  nodes.push({
    id: responseNodeId,
    kind: "response",
    label: responseLabel(entry),
    depth: 2,
    metadata: { httpMethod: pickHttpMethod(entry) },
  });
  edges.push({
    id: nextEdgeId(),
    from: handlerNodeId,
    to: responseNodeId,
    kind: "return",
    confidence: "high",
  });

  return FlowGraphSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    entryId: entry.id,
    nodes,
    edges,
    cycles,
    truncations,
  });
}

function extractInputMetadata(entry: IOEntryRegistry["entries"][number]): Record<string, unknown> {
  const md = entry.metadata ?? {};
  const headers: string[] = [];
  if (typeof md.auth === "string" && md.auth.includes("x-user-id")) {
    headers.push("x-user-id");
  }
  const out: Record<string, unknown> = {};
  if (headers.length > 0) out.headers = headers;
  if (Array.isArray(md.queryParams)) out.queryParams = md.queryParams;
  if (Array.isArray(md.pathParams)) out.pathParams = md.pathParams;
  if (md.requestBodyShape) out.bodyShape = md.requestBodyShape;
  return out;
}

function handlerLabel(entry: IOEntryRegistry["entries"][number]): string {
  const method = pickHttpMethod(entry);
  const path = pickPath(entry);
  return `${method} ${path} handler`;
}

function pickHttpMethod(entry: IOEntryRegistry["entries"][number]): string {
  const md = entry.metadata as Record<string, unknown> | undefined;
  const m = md?.httpMethod;
  return typeof m === "string" ? m : entry.displayName.split(" ")[0];
}

function pickPath(entry: IOEntryRegistry["entries"][number]): string {
  const md = entry.metadata as Record<string, unknown> | undefined;
  const p = md?.path;
  return typeof p === "string" ? p : entry.displayName.split(" ").slice(1).join(" ");
}

function responseLabel(entry: IOEntryRegistry["entries"][number]): string {
  const method = pickHttpMethod(entry);
  switch (method) {
    case "POST":
      return "201 created";
    case "DELETE":
      return "200 ok";
    case "GET":
    default:
      return "200 ok";
  }
}

function prismaCallLabel(da: SymbolGraph["dataAccessPoints"][number]): string {
  const op = prismaOpFromRaw(da.raw ?? "") || da.operation;
  return `prisma.${da.target.toLowerCase()}.${op}`;
}

function prismaOpFromRaw(raw: string): string {
  // raw looks like `prisma.<model>.<op>(...)` or `tx.<model>.<op>(...)`.
  // The op is the third dotted segment; any `.map(` / `.filter(` inside the
  // argument list is irrelevant and must not be picked up.
  const m = raw.match(/(?:prisma|tx)\.\w+\.(\w+)\s*\(/);
  return m?.[1] ?? "";
}
