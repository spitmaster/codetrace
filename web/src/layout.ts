/**
 * Dagre-based vertical layout for FlowGraph 2D rendering.
 *
 * Layout direction = TB (top → bottom) per SPEC §4 visual规范 ("布局算法
 * dagre (TB 方向)"). Min node spacing 80px (SPEC).
 *
 * Why dagre and not react-flow's built-in: react-flow gives us interactive
 * canvas + edge styling but no layout algorithm; dagre is the de-facto
 * Sugiyama implementation for directed graphs and integrates cleanly.
 */
import dagre from "dagre";
import type { Edge, Node } from "@xyflow/react";
import type { FlowGraph } from "./types";

const NODE_W = 200;
const NODE_H = 56;

export interface LayoutResult {
  nodes: Node[];
  edges: Edge[];
}

export function layout(flow: FlowGraph, annLookup: Map<string, string>): LayoutResult {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 80, ranksep: 60, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of flow.nodes) {
    g.setNode(n.id, { width: NODE_W, height: NODE_H });
  }
  for (const e of flow.edges) {
    g.setEdge(e.from, e.to);
  }
  dagre.layout(g);

  const nodes: Node[] = flow.nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      id: n.id,
      position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
      data: {
        flowNode: n,
        businessLabel: annLookup.get(n.id),
      },
      type: "flow", // custom registered in App.tsx
    };
  });

  const edges: Edge[] = flow.edges.map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    type: "smoothstep",
    data: { edge: e },
    animated: e.kind === "write" || e.kind === "delete",
    label: e.kind,
    style: edgeStyle(e.kind),
    labelStyle: { fill: "#555", fontSize: 11 },
    markerEnd: { type: "arrowclosed" as const, width: 14, height: 14 },
  }));
  return { nodes, edges };
}

function edgeStyle(kind: string): React.CSSProperties {
  switch (kind) {
    case "write":
      return { stroke: "#15803d", strokeWidth: 3 };
    case "delete":
      return { stroke: "#dc2626", strokeWidth: 3 };
    case "read":
      return { stroke: "#475569", strokeWidth: 1.5, strokeDasharray: "4 4" };
    case "return":
      return { stroke: "#7c3aed", strokeWidth: 2 };
    case "input-bind":
      return { stroke: "#6b7280", strokeWidth: 1.5, strokeDasharray: "2 2" };
    case "call":
    default:
      return { stroke: "#0ea5e9", strokeWidth: 1.5 };
  }
}
