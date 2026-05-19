/**
 * BusinessAnnotations accuracy evaluator.
 *
 * Compares a produced BusinessAnnotations against ground-truth and computes
 * the four SPEC §7 quality signals:
 *
 *   1. nodeCoverage      — fraction of GT node IDs present in candidate
 *   2. edgeCoverage      — fraction of GT edge IDs present in candidate
 *   3. labelMatchRate    — fraction of nodes whose businessLabel "matches"
 *                          the GT label by Chinese token overlap
 *   4. evidenceNonEmpty  — fraction of annotations with non-empty evidence
 *                          (red line #2 — should be 100%)
 *
 * AND an aggregate `highMediumRate` = (high + medium) / total annotations.
 * SPEC §7 4th bullet asks "BusinessAnnotations 人工评估 ≥ 80%"; this is the
 * machine proxy for that.
 *
 * Why token-overlap label match (not exact string match): the LLM/mock can
 * legitimately phrase the same fact differently — "读取用户表" vs "读用户表"
 * vs "用户存在性校验" should all count. We use a synonym map + Chinese
 * bigram Jaccard to bridge plausible variants. Threshold 0.30 (calibrated
 * against MockProvider vs ground-truth — see calibration notes in the
 * test suite).
 */
import {
  BusinessAnnotations,
  BusinessAnnotationsSchema,
} from "../schemas";

export interface PerEntryReport {
  entryId: string;
  nodeCount: { gt: number; cand: number; matched: number };
  edgeCount: { gt: number; cand: number; matched: number };
  nodeCoverage: number;
  edgeCoverage: number;
  labelMatchRate: number;
  edgeLabelMatchRate: number;
  evidenceNonEmpty: number;
  highMediumRate: number;
  // Concrete labels showing mismatches — helpful for prompt iteration.
  labelMismatches: Array<{ nodeId: string; gt: string; cand: string }>;
}

export interface AggregateReport {
  perEntry: PerEntryReport[];
  // Average across entries (equal weight).
  avgNodeCoverage: number;
  avgEdgeCoverage: number;
  avgLabelMatchRate: number;
  avgEdgeLabelMatchRate: number;
  avgEvidenceNonEmpty: number;
  avgHighMediumRate: number;
  // For SPEC §7 reporting — is the BusinessAnnotations bar (≥ 80%) cleared?
  meetsBusinessAnnotations80: boolean;
}

// ---------------------------------------------------------------------------
// Label match heuristics
// ---------------------------------------------------------------------------

/** Synonym buckets — if both labels share a bucket, that counts as a match. */
const SYNONYM_BUCKETS: string[][] = [
  ["读取", "查询", "读", "查", "select", "find"],
  ["写入", "新增", "插入", "持久化", "create", "insert"],
  ["更新", "改", "翻", "状态机", "update"],
  ["删除", "del", "drop"],
  ["统计", "总数", "count"],
  ["扣减", "减", "decrement", "扣库存"],
  ["增加", "回滚", "restore", "increment"],
  ["鉴权", "校验身份", "认证", "auth"],
  ["接口入口", "入口", "handler", "路由"],
  ["返回", "响应", "回客户端", "response"],
  ["服务编排", "事务编排", "编排", "service"],
];

const TABLE_TOKENS = ["用户表", "商品表", "订单表", "订单行表"];

function normalize(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

function chineseBigrams(s: string): Set<string> {
  const t = normalize(s);
  const out = new Set<string>();
  for (let i = 0; i + 1 < t.length; i++) out.add(t.slice(i, i + 2));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Label match score in [0,1]. Returns 1 if labels share a synonym bucket AND
 * mention the same business table (when applicable), otherwise the bigram
 * Jaccard score.
 */
export function labelScore(gt: string, cand: string): number {
  const g = normalize(gt);
  const c = normalize(cand);
  if (!c) return 0;
  if (g === c) return 1;
  // Substring containment (one direction) — covers "写入订单表" vs "写入订单表(状态翻转)"
  if (g.includes(c) || c.includes(g)) {
    const len = Math.min(g.length, c.length) / Math.max(g.length, c.length);
    if (len > 0.4) return 0.9;
  }
  // Synonym bucket match + table-token consistency.
  const sharedBucket = SYNONYM_BUCKETS.some(
    (b) => b.some((w) => g.includes(w)) && b.some((w) => c.includes(w))
  );
  const gTbl = TABLE_TOKENS.find((t) => g.includes(t));
  const cTbl = TABLE_TOKENS.find((t) => c.includes(t));
  if (sharedBucket && (!gTbl || !cTbl || gTbl === cTbl)) {
    // synonym match — boost by Jaccard so empty matches still get scored
    const j = jaccard(chineseBigrams(g), chineseBigrams(c));
    return Math.max(0.7, j);
  }
  return jaccard(chineseBigrams(g), chineseBigrams(c));
}

/** A label is considered a "match" for coverage stats when score >= 0.30. */
export const LABEL_MATCH_THRESHOLD = 0.3;

// ---------------------------------------------------------------------------
// Eval driver
// ---------------------------------------------------------------------------

function stripUnderscores(o: unknown): unknown {
  // Ground-truth files contain `_comment` / `_evidenceSource` keys for human
  // readability — zod schemas accept them via passthrough, but we strip them
  // here to keep the eval logic clean.
  if (Array.isArray(o)) return o.map(stripUnderscores);
  if (o && typeof o === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (k.startsWith("_")) continue;
      out[k] = stripUnderscores(v);
    }
    return out;
  }
  return o;
}

export function parseAnnotations(json: unknown): BusinessAnnotations {
  return BusinessAnnotationsSchema.parse(stripUnderscores(json));
}

export function evaluateEntry(
  gt: BusinessAnnotations,
  cand: BusinessAnnotations
): PerEntryReport {
  if (gt.entryId !== cand.entryId) {
    throw new Error(
      `entryId mismatch: gt=${gt.entryId} cand=${cand.entryId}`
    );
  }
  const gtNodes = new Map(gt.nodeAnnotations.map((a) => [a.nodeId, a]));
  const gtEdges = new Map(gt.edgeAnnotations.map((a) => [a.edgeId, a]));
  const candNodes = new Map(cand.nodeAnnotations.map((a) => [a.nodeId, a]));
  const candEdges = new Map(cand.edgeAnnotations.map((a) => [a.edgeId, a]));

  let nodeMatched = 0;
  let labelMatched = 0;
  const labelMismatches: PerEntryReport["labelMismatches"] = [];
  for (const [id, g] of gtNodes) {
    const c = candNodes.get(id);
    if (c) {
      nodeMatched++;
      const sc = labelScore(g.businessLabel, c.businessLabel);
      if (sc >= LABEL_MATCH_THRESHOLD) labelMatched++;
      else labelMismatches.push({ nodeId: id, gt: g.businessLabel, cand: c.businessLabel });
    }
  }
  let edgeMatched = 0;
  let edgeLabelMatched = 0;
  for (const [id, g] of gtEdges) {
    const c = candEdges.get(id);
    if (c) {
      edgeMatched++;
      if (labelScore(g.businessLabel, c.businessLabel) >= LABEL_MATCH_THRESHOLD)
        edgeLabelMatched++;
    }
  }
  const nodeCoverage = gtNodes.size ? nodeMatched / gtNodes.size : 1;
  const edgeCoverage = gtEdges.size ? edgeMatched / gtEdges.size : 1;
  const labelMatchRate = nodeMatched ? labelMatched / nodeMatched : 0;
  const edgeLabelMatchRate = edgeMatched ? edgeLabelMatched / edgeMatched : 0;

  // Evidence non-empty rate across ALL candidate annotations (red line #2).
  const allCandAnns = [...cand.nodeAnnotations, ...cand.edgeAnnotations];
  const nonEmpty = allCandAnns.filter((a) => a.evidence.length > 0).length;
  const evidenceNonEmpty = allCandAnns.length ? nonEmpty / allCandAnns.length : 1;

  // confidence high+medium proportion (proxy for "≥ 80% useful translation").
  const hm = allCandAnns.filter((a) => a.confidence !== "low").length;
  const highMediumRate = allCandAnns.length ? hm / allCandAnns.length : 0;

  return {
    entryId: gt.entryId,
    nodeCount: { gt: gtNodes.size, cand: candNodes.size, matched: nodeMatched },
    edgeCount: { gt: gtEdges.size, cand: candEdges.size, matched: edgeMatched },
    nodeCoverage,
    edgeCoverage,
    labelMatchRate,
    edgeLabelMatchRate,
    evidenceNonEmpty,
    highMediumRate,
    labelMismatches,
  };
}

export function aggregate(reports: PerEntryReport[]): AggregateReport {
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  const avgNodeCoverage = avg(reports.map((r) => r.nodeCoverage));
  const avgEdgeCoverage = avg(reports.map((r) => r.edgeCoverage));
  const avgLabelMatchRate = avg(reports.map((r) => r.labelMatchRate));
  const avgEdgeLabelMatchRate = avg(reports.map((r) => r.edgeLabelMatchRate));
  const avgEvidenceNonEmpty = avg(reports.map((r) => r.evidenceNonEmpty));
  const avgHighMediumRate = avg(reports.map((r) => r.highMediumRate));
  return {
    perEntry: reports,
    avgNodeCoverage,
    avgEdgeCoverage,
    avgLabelMatchRate,
    avgEdgeLabelMatchRate,
    avgEvidenceNonEmpty,
    avgHighMediumRate,
    // SPEC §7: BusinessAnnotations 人工评估 ≥ 80%. Our automated proxy:
    // average label match across nodes AND high+medium confidence ≥ 80%.
    meetsBusinessAnnotations80:
      avgLabelMatchRate >= 0.8 && avgHighMediumRate >= 0.8,
  };
}
