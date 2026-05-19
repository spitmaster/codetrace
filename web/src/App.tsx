/**
 * codeviz M1 web frontend — App shell.
 *
 * Layout (per SPEC §4):
 *   - Top bar:    project label + breadcrumb of current entry
 *   - Left rail:  IO entry list (280px fixed)
 *   - Center:     FlowGraph 2D canvas (react-flow)
 *   - Right rail: Detail panel — narrative, selected node label + evidence
 *
 * Why such a thin app shell:
 *   - We are deliberately STILL 2D in M1 (red line #3).
 *   - State management = plain useState; SPEC §5 lists Zustand but for M1
 *     we have ~10 lines of state, so adding a store would be ceremony.
 *     We will migrate when state crosses the 3-component threshold.
 */
import { useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import { FlowNodeView } from "./FlowNode";
import { layout } from "./layout";
import { loadEntryBundle, loadRegistry, type BundleForEntry } from "./dataLoader";
import type { IOEntry, IOEntryRegistry } from "./types";

const nodeTypes = { flow: FlowNodeView };

export function App(): JSX.Element {
  const [registry, setRegistry] = useState<IOEntryRegistry | null>(null);
  const [bundle, setBundle] = useState<BundleForEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  useEffect(() => {
    loadRegistry().then(setRegistry).catch((e) => setError(String(e)));
  }, []);

  const selectEntry = (e: IOEntry) => {
    setBundle(null);
    setSelectedNodeId(null);
    loadEntryBundle(e).then(setBundle).catch((err) => setError(String(err)));
  };

  // Auto-select first entry on registry load for nicer first-paint.
  useEffect(() => {
    if (registry && !bundle && registry.entries.length > 0) {
      selectEntry(registry.entries[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry]);

  const flowGraph = bundle?.flow;
  const annotations = bundle?.annotations;

  // Label lookup: nodeId → businessLabel. Also build confidence overlay.
  const { laidNodes, laidEdges, confidenceByNode, evidenceByNode, edgeByNode } =
    useMemo(() => {
      if (!flowGraph || !annotations) {
        return {
          laidNodes: [] as Node[],
          laidEdges: [] as Edge[],
          confidenceByNode: new Map<string, string>(),
          evidenceByNode: new Map<string, string[]>(),
          edgeByNode: new Map<string, { label: string; evidence: string[] }>(),
        };
      }
      const labelLookup = new Map<string, string>();
      const confLookup = new Map<string, string>();
      const evLookup = new Map<string, string[]>();
      for (const ann of annotations.nodeAnnotations) {
        labelLookup.set(ann.nodeId, ann.businessLabel);
        confLookup.set(ann.nodeId, ann.confidence);
        evLookup.set(ann.nodeId, ann.evidence);
      }
      const edgeLookup = new Map<string, { label: string; evidence: string[] }>();
      for (const ea of annotations.edgeAnnotations) {
        edgeLookup.set(ea.edgeId, { label: ea.businessLabel, evidence: ea.evidence });
      }
      const out = layout(flowGraph, labelLookup);
      // Inject confidence + evidence into node data for FlowNodeView opacity.
      for (const n of out.nodes) {
        (n.data as Record<string, unknown>).confidence = confLookup.get(n.id);
        (n.data as Record<string, unknown>).evidence = evLookup.get(n.id);
      }
      // Inject business label into edges if present.
      for (const e of out.edges) {
        const ann = edgeLookup.get(e.id);
        if (ann) e.label = ann.label;
      }
      return {
        laidNodes: out.nodes,
        laidEdges: out.edges,
        confidenceByNode: confLookup,
        evidenceByNode: evLookup,
        edgeByNode: edgeLookup,
      };
    }, [flowGraph, annotations]);

  const onSelectionChange = (params: OnSelectionChangeParams) => {
    const n = params.nodes[0];
    setSelectedNodeId(n ? n.id : null);
  };

  const selectedNode = useMemo(() => {
    if (!flowGraph || !selectedNodeId) return null;
    return flowGraph.nodes.find((n) => n.id === selectedNodeId) ?? null;
  }, [flowGraph, selectedNodeId]);

  const selectedAnnotation = useMemo(() => {
    if (!annotations || !selectedNodeId) return null;
    return annotations.nodeAnnotations.find((a) => a.nodeId === selectedNodeId) ?? null;
  }, [annotations, selectedNodeId]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "system-ui" }}>
      {/* ---- Top bar ---- */}
      <header
        style={{
          height: 48,
          padding: "0 16px",
          display: "flex",
          alignItems: "center",
          borderBottom: "1px solid #e5e7eb",
          background: "#fafafa",
        }}
      >
        <strong style={{ fontSize: 16, color: "#0f172a" }}>codeviz</strong>
        <span style={{ marginLeft: 8, fontSize: 13, color: "#64748b" }}>
          代码可视化阅读器 · M1 (2D)
        </span>
        {bundle && (
          <span style={{ marginLeft: 24, fontSize: 13, color: "#0f172a" }}>
            <span style={{ color: "#64748b" }}>当前入口:</span>{" "}
            <code>{bundle.entry.displayName ?? bundle.entry.id}</code>
          </span>
        )}
      </header>

      {/* ---- Body ---- */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Left rail: entry list */}
        <aside
          style={{
            width: 280,
            borderRight: "1px solid #e5e7eb",
            overflowY: "auto",
            background: "#fafafa",
          }}
        >
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #e5e7eb" }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: "#0f172a" }}>
              IO 入口 ({registry?.entries.length ?? 0})
            </div>
          </div>
          {error && (
            <div style={{ padding: 16, color: "#dc2626", fontSize: 12 }}>{error}</div>
          )}
          {registry?.entries.map((e) => {
            const isSel = bundle?.entry.id === e.id;
            return (
              <button
                key={e.id}
                onClick={() => selectEntry(e)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 16px",
                  border: "none",
                  background: isSel ? "#eff6ff" : "transparent",
                  borderLeft: isSel ? "3px solid #3b82f6" : "3px solid transparent",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                <div style={{ fontSize: 13, color: "#0f172a", fontWeight: isSel ? 600 : 500 }}>
                  <code style={{ color: methodColor(e.method), fontSize: 12 }}>
                    {e.method}
                  </code>{" "}
                  {e.path}
                </div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                  {e.displayName}
                </div>
              </button>
            );
          })}
        </aside>

        {/* Center: FlowGraph canvas */}
        <main style={{ flex: 1, position: "relative", minWidth: 0 }}>
          {bundle ? (
            <ReactFlow
              nodes={laidNodes}
              edges={laidEdges}
              nodeTypes={nodeTypes}
              fitView
              onSelectionChange={onSelectionChange}
              defaultEdgeOptions={{ type: "smoothstep" }}
              minZoom={0.2}
              maxZoom={2.5}
            >
              <Background gap={20} size={1.2} color="#e5e7eb" />
              <Controls />
              <MiniMap pannable zoomable nodeColor={(n) => miniColor(n)} />
            </ReactFlow>
          ) : (
            <div style={{ padding: 32, color: "#64748b" }}>选择左侧入口以渲染流图……</div>
          )}
        </main>

        {/* Right rail: detail panel */}
        <aside
          style={{
            width: 360,
            borderLeft: "1px solid #e5e7eb",
            overflowY: "auto",
            background: "#fafafa",
            padding: 16,
          }}
        >
          {/* Narrative (always shown when bundle loaded) */}
          {bundle && annotations && (
            <section style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>
                业务流水 narrative
                <span style={{ marginLeft: 6, fontSize: 11, color: confColor(annotations.narrativeConfidence) }}>
                  ({annotations.narrativeConfidence})
                </span>
              </div>
              <div
                style={{
                  fontSize: 14,
                  lineHeight: 1.55,
                  color: "#0f172a",
                  background: "#fff",
                  border: "1px solid #e5e7eb",
                  borderRadius: 8,
                  padding: 12,
                }}
              >
                {annotations.narrative}
              </div>
            </section>
          )}

          {/* Selected node detail */}
          {selectedNode && selectedAnnotation ? (
            <section>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>
                选中节点
              </div>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: "#0f172a",
                  marginBottom: 6,
                }}
              >
                {selectedAnnotation.businessLabel}
                {selectedAnnotation.confidence === "low" && (
                  <span title="低置信度,LLM 不确定" style={{ marginLeft: 6 }}>❓</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: confColor(selectedAnnotation.confidence), marginBottom: 12 }}>
                置信度 · {selectedAnnotation.confidence}
              </div>
              {selectedAnnotation.businessDescription && (
                <p style={{ fontSize: 13, color: "#334155", lineHeight: 1.55, marginBottom: 12 }}>
                  {selectedAnnotation.businessDescription}
                </p>
              )}
              <div style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", marginBottom: 6 }}>
                evidence (代码事实)
              </div>
              <ul style={{ paddingLeft: 18, margin: 0 }}>
                {selectedAnnotation.evidence.map((ev, i) => (
                  <li key={i} style={{ fontSize: 12, color: "#475569", marginBottom: 4, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                    {ev}
                  </li>
                ))}
              </ul>
              {selectedNode.metadata && Object.keys(selectedNode.metadata).length > 0 && (
                <details style={{ marginTop: 12 }}>
                  <summary style={{ fontSize: 12, color: "#64748b", cursor: "pointer" }}>原始 metadata</summary>
                  <pre style={{ fontSize: 11, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 4, padding: 8, marginTop: 6, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                    {JSON.stringify(selectedNode.metadata, null, 2)}
                  </pre>
                </details>
              )}
            </section>
          ) : bundle ? (
            <p style={{ fontSize: 12, color: "#94a3b8" }}>点击中央流图中的节点查看 evidence……</p>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function methodColor(m?: string): string {
  switch (m) {
    case "GET":
      return "#15803d";
    case "POST":
      return "#1d4ed8";
    case "PUT":
      return "#b45309";
    case "DELETE":
      return "#b91c1c";
    default:
      return "#475569";
  }
}

function confColor(c?: string): string {
  switch (c) {
    case "high":
      return "#15803d";
    case "medium":
      return "#b45309";
    case "low":
      return "#dc2626";
    default:
      return "#64748b";
  }
}

function miniColor(n: Node): string {
  const k = (n.data as { flowNode?: { kind: string } })?.flowNode?.kind;
  switch (k) {
    case "function":
      return "#3b82f6";
    case "table":
      return "#15803d";
    case "input":
    case "response":
      return "#94a3b8";
    default:
      return "#cbd5e1";
  }
}
