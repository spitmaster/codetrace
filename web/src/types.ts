// Mirror of cli/src/schemas types — kept in sync manually for M1 to avoid a
// monorepo workspace setup. Schema version pinned to 0.1.0; the M1
// orchestrator approves bumps on both sides (overview red line #6).

export type Confidence = "high" | "medium" | "low";

export interface IOEntry {
  id: string;
  kind: "http";
  method?: string;
  path?: string;
  displayName: string;
  handlerSymbolId: string;
  middlewareSymbolIds?: string[];
  confidence: Confidence;
}

export interface IOEntryRegistry {
  schemaVersion: string;
  entries: IOEntry[];
}

export type FlowNodeKind =
  | "function"
  | "table"
  | "file"
  | "external-api"
  | "queue"
  | "response"
  | "input";

export type FlowEdgeKind =
  | "call"
  | "read"
  | "write"
  | "delete"
  | "publish"
  | "http-call"
  | "return"
  | "input-bind";

export interface FlowNode {
  id: string;
  kind: FlowNodeKind;
  label: string;
  symbolId?: string;
  depth: number;
  metadata?: Record<string, unknown>;
}

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  kind: FlowEdgeKind;
  confidence: Confidence;
  metadata?: Record<string, unknown>;
}

export interface FlowGraph {
  schemaVersion: string;
  entryId: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  cycles?: string[][];
  truncations?: { at: string; reason: string }[];
}

export interface NodeAnnotation {
  nodeId: string;
  businessLabel: string;
  businessDescription?: string;
  confidence: Confidence;
  evidence: string[];
}

export interface EdgeAnnotation {
  edgeId: string;
  businessLabel: string;
  confidence: Confidence;
  evidence: string[];
}

export interface BusinessAnnotations {
  schemaVersion: string;
  entryId: string;
  narrative: string;
  narrativeConfidence: Confidence;
  narrativeEvidence?: string[];
  nodeAnnotations: NodeAnnotation[];
  edgeAnnotations: EdgeAnnotation[];
}
