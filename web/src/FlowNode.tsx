/**
 * Custom node renderer for codeviz 2D FlowGraph.
 *
 * SPEC §4 visual规范 mapping:
 *   - function = 蓝   (bg-blue-50, border-blue-500)
 *   - table    = 绿   (bg-green-50, border-green-600)
 *   - file     = 橙   (bg-orange-50, border-orange-500)
 *   - input/response = 灰
 *   - low confidence: 40% opacity + ❓ marker
 *   - medium: 70% opacity
 *   - high: 100% opacity
 */
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Confidence, FlowNode as FlowNodeType } from "./types";

interface Data {
  flowNode: FlowNodeType;
  businessLabel?: string;
  confidence?: Confidence;
}

function colorFor(kind: string): { bg: string; border: string } {
  switch (kind) {
    case "function":
      return { bg: "#eff6ff", border: "#3b82f6" };
    case "table":
      return { bg: "#f0fdf4", border: "#15803d" };
    case "file":
      return { bg: "#fff7ed", border: "#f97316" };
    case "input":
    case "response":
      return { bg: "#f3f4f6", border: "#9ca3af" };
    default:
      return { bg: "#fafafa", border: "#cbd5e1" };
  }
}

function opacityFor(c?: Confidence): number {
  switch (c) {
    case "low":
      return 0.4;
    case "medium":
      return 0.75;
    case "high":
    default:
      return 1;
  }
}

export function FlowNodeView(props: NodeProps) {
  const data = props.data as Data;
  const { flowNode, businessLabel, confidence } = data;
  const { bg, border } = colorFor(flowNode.kind);
  const op = opacityFor(confidence);
  const isLow = confidence === "low";
  return (
    <div
      style={{
        background: bg,
        border: `2px solid ${border}`,
        borderRadius: 10,
        padding: "8px 12px",
        minWidth: 180,
        maxWidth: 220,
        fontFamily: "system-ui, -apple-system, sans-serif",
        opacity: op,
        boxShadow: props.selected
          ? `0 0 0 3px ${border}40, 0 1px 2px rgba(0,0,0,0.1)`
          : "0 1px 2px rgba(0,0,0,0.08)",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: border }} />
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "#0f172a",
          lineHeight: 1.3,
          wordBreak: "break-all",
        }}
      >
        {businessLabel ?? flowNode.label} {isLow && <span title="低置信度">❓</span>}
      </div>
      <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
        {flowNode.kind}
        {flowNode.symbolId ? ` · ${flowNode.symbolId.split("#").slice(-1)[0]}` : ""}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: border }} />
    </div>
  );
}
