/**
 * M1 end-to-end regression script.
 *
 * Pipeline (fully offline by default — uses MockProvider):
 *   1. analyze fixtures/fixture-a-order-app/backend  → SymbolGraph
 *   2. map-io  fixtures/fixture-a-order-app/backend  → IOEntryRegistry
 *   3. for each entry in registry:
 *        a. trace      → FlowGraph
 *        b. translate  → BusinessAnnotations (mock provider)
 *   4. evaluate each artefact against ground-truth
 *   5. emit reports/m1-accuracy.md (per SPEC §7)
 *
 * Exit codes:
 *   0 — all SPEC §7 bars cleared (SymbolGraph ≥ 80%, IO 100%, FlowGraph ≥ 80%)
 *   1 — any bar missed (BusinessAnnotations 80% target is reported but NOT
 *       a hard fail under mock provider; it's the LLM's job and mock can't
 *       hit it)
 *
 * Why a separate `npm run e2e:m1` rather than baking this into vitest:
 *   - vitest is for unit/contract testing. This is a full pipeline rehearsal
 *     that produces a human-readable report.
 *   - Keeps the test suite under 1s for fast iteration; e2e can stay slower.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { analyzeProject } from "../analyzer";
import { mapEntries } from "../io-mapper";
import { trace } from "../tracer";
import {
  MockProvider,
  translate as runTranslate,
} from "../translator";
import {
  SymbolGraphSchema,
  IOEntryRegistrySchema,
  FlowGraphSchema,
  BusinessAnnotationsSchema,
} from "../schemas";
import {
  evaluateSymbolGraph,
  evaluateIOEntryRegistry,
  evaluateFlowGraph,
  SymbolGraphReport,
  IOEntryReport,
  FlowGraphReport,
} from "./schema-eval";
import {
  evaluateEntry,
  aggregate,
  parseAnnotations,
  PerEntryReport,
  AggregateReport,
} from "./evaluate";

interface EntrySlug {
  id: string;
  slug: string;
}

const ENTRY_SLUGS: EntrySlug[] = [
  { id: "io:http:POST:/api/orders", slug: "POST_api_orders" },
  { id: "io:http:GET:/api/orders", slug: "GET_api_orders" },
  { id: "io:http:GET:/api/orders/:id", slug: "GET_api_orders_id" },
  { id: "io:http:DELETE:/api/orders/:id", slug: "DELETE_api_orders_id" },
];

interface E2EOptions {
  projectRoot: string;
  groundTruthDir: string;
  outDir: string;
  reportFile: string;
}

function readJson(p: string): unknown {
  return JSON.parse(readFileSync(p, "utf8"));
}
function writeJson(p: string, data: unknown): void {
  if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf8");
}

interface FullReport {
  symbolGraph: SymbolGraphReport;
  ioRegistry: IOEntryReport;
  flowGraphs: FlowGraphReport[];
  businessAnnotations: AggregateReport;
}

async function runPipeline(opts: E2EOptions): Promise<FullReport> {
  // ---- 1) Static analysis (SymbolGraph) -------------------------------
  const { graph: symbolGraph } = analyzeProject(opts.projectRoot);
  writeJson(resolve(opts.outDir, "symbol-graph.json"), symbolGraph);
  const gtSymbol = SymbolGraphSchema.parse(
    readJson(resolve(opts.groundTruthDir, "symbol-graph.expected.json"))
  );
  const symbolReport = evaluateSymbolGraph(gtSymbol, symbolGraph);

  // ---- 2) IO Entry mapping (IOEntryRegistry) --------------------------
  const ioRegistry = mapEntries({ projectRoot: opts.projectRoot, symbolGraph });
  writeJson(resolve(opts.outDir, "io-entry-registry.json"), ioRegistry);
  const gtIO = IOEntryRegistrySchema.parse(
    readJson(resolve(opts.groundTruthDir, "io-entry-registry.expected.json"))
  );
  const ioReport = evaluateIOEntryRegistry(gtIO, ioRegistry);

  // ---- 3) Per-entry: trace + translate --------------------------------
  const provider = new MockProvider();
  const flowReports: FlowGraphReport[] = [];
  const businessPerEntry: PerEntryReport[] = [];
  for (const e of ENTRY_SLUGS) {
    const flow = trace({ symbolGraph, ioEntries: ioRegistry, entryId: e.id });
    writeJson(resolve(opts.outDir, `flow-graph-${e.slug}.json`), flow);
    const gtFlow = FlowGraphSchema.parse(
      readJson(resolve(opts.groundTruthDir, `flow-graph-${e.slug}.expected.json`))
    );
    flowReports.push(evaluateFlowGraph(gtFlow, flow));

    const annotations = await runTranslate({ provider, flow });
    writeJson(resolve(opts.outDir, `business-annotations-${e.slug}.json`), annotations);
    const gtAnn = parseAnnotations(
      readJson(resolve(opts.groundTruthDir, `business-annotations-${e.slug}.expected.json`))
    );
    const candAnn = BusinessAnnotationsSchema.parse(annotations);
    businessPerEntry.push(evaluateEntry(gtAnn, candAnn));
  }
  return {
    symbolGraph: symbolReport,
    ioRegistry: ioReport,
    flowGraphs: flowReports,
    businessAnnotations: aggregate(businessPerEntry),
  };
}

function pct(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

function flag(ok: boolean): string {
  return ok ? "PASS" : "MISS";
}

function renderReport(r: FullReport): string {
  const lines: string[] = [];
  lines.push("# M1 端到端准确率报告");
  lines.push("");
  lines.push("> 自动生成 by `npm run e2e:m1`。Provider = mock(确定性、离线、无 LLM)。");
  lines.push(
    "> Provider 切换:`npm run e2e:m1 -- --provider claude` 需要 ANTHROPIC_API_KEY。"
  );
  lines.push(`> 生成时间: ${new Date().toISOString()}`);
  lines.push("");

  // ---------------- SymbolGraph ----------------
  const sg = r.symbolGraph;
  lines.push("## 1. SymbolGraph 召回率(SPEC §7 ≥ 80%)");
  lines.push("");
  lines.push(`| 指标 | 值 |`);
  lines.push(`|---|---|`);
  lines.push(`| 期望符号数 | ${sg.expectedSymbols} |`);
  lines.push(`| 匹配符号数 | ${sg.matchedSymbols} |`);
  lines.push(`| 召回率 | **${pct(sg.recall)}** ${flag(sg.recall >= 0.8)} |`);
  if (sg.missing.length) {
    lines.push("");
    lines.push("缺失符号(前 10):");
    for (const m of sg.missing.slice(0, 10)) lines.push(`- ${m}`);
  }
  lines.push("");

  // ---------------- IOEntryRegistry ----------------
  const io = r.ioRegistry;
  lines.push("## 2. IOEntryRegistry 准确率(SPEC §7 = 100%)");
  lines.push("");
  lines.push(`| 指标 | 值 |`);
  lines.push(`|---|---|`);
  lines.push(`| 期望 entry 数 | ${io.expectedEntries} |`);
  lines.push(`| 匹配 entry 数 | ${io.matchedEntries} |`);
  lines.push(`| 准确率 | **${pct(io.accuracy)}** ${flag(io.accuracy >= 1)} |`);
  lines.push(`| 缺失 | ${io.missing.length} |`);
  lines.push(`| 候选额外 entry | ${io.extras.length} |`);
  lines.push(`| 字段不匹配数 | ${io.fieldMismatches.length} |`);
  if (io.fieldMismatches.length) {
    lines.push("");
    lines.push("字段不匹配明细(前 10):");
    for (const m of io.fieldMismatches.slice(0, 10)) {
      lines.push(`- \`${m.entryId}\` / \`${m.field}\`: gt=\`${JSON.stringify(m.gt)}\` cand=\`${JSON.stringify(m.cand)}\``);
    }
  }
  lines.push("");

  // ---------------- FlowGraph ----------------
  lines.push("## 3. FlowGraph 主路径覆盖(SPEC §7 ≥ 80%)");
  lines.push("");
  lines.push(`| Entry | nodes (cand/gt) | edges (cand/gt) | nodeCoverage | edgeCoverage | table-ops | 结果 |`);
  lines.push(`|---|---|---|---|---|---|---|`);
  let mainPathOk = true;
  for (const f of r.flowGraphs) {
    const okN = f.nodeCoverage >= 0.8;
    const okE = f.edgeCoverage >= 0.8;
    const okT = f.writeReadTableCoverage >= 0.8;
    const ok = okN && okE && okT;
    if (!ok) mainPathOk = false;
    lines.push(
      `| ${f.entryId} | ${f.candNodes}/${f.gtNodes} | ${f.candEdges}/${f.gtEdges} | ${pct(f.nodeCoverage)} | ${pct(f.edgeCoverage)} | ${pct(f.writeReadTableCoverage)} | ${flag(ok)} |`
    );
  }
  const avgFlowNode = r.flowGraphs.reduce((s, f) => s + f.nodeCoverage, 0) / r.flowGraphs.length;
  const avgFlowEdge = r.flowGraphs.reduce((s, f) => s + f.edgeCoverage, 0) / r.flowGraphs.length;
  lines.push("");
  lines.push(`平均 nodeCoverage = **${pct(avgFlowNode)}**;平均 edgeCoverage = **${pct(avgFlowEdge)}**;主路径整体 ${flag(mainPathOk)}`);
  lines.push("");

  // ---------------- BusinessAnnotations ----------------
  const ba = r.businessAnnotations;
  lines.push("## 4. BusinessAnnotations 准确率(SPEC §7 人工评估 ≥ 80%;此处为 mock 自动近似)");
  lines.push("");
  lines.push(`| Entry | nodeCov | labelMatch | edgeLabelMatch | evidenceNonEmpty | high+medium 比例 |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const p of ba.perEntry) {
    lines.push(
      `| ${p.entryId} | ${pct(p.nodeCoverage)} | ${pct(p.labelMatchRate)} | ${pct(p.edgeLabelMatchRate)} | ${pct(p.evidenceNonEmpty)} | ${pct(p.highMediumRate)} |`
    );
  }
  lines.push("");
  lines.push(`平均 nodeCoverage = **${pct(ba.avgNodeCoverage)}**`);
  lines.push(`平均 labelMatchRate = **${pct(ba.avgLabelMatchRate)}**`);
  lines.push(`平均 edgeLabelMatchRate = **${pct(ba.avgEdgeLabelMatchRate)}**`);
  lines.push(`平均 evidenceNonEmpty = **${pct(ba.avgEvidenceNonEmpty)}** (红线 #2 要求 100%)`);
  lines.push(`平均 high+medium 比例 = **${pct(ba.avgHighMediumRate)}**`);
  lines.push(`80% 双门槛(labelMatch ≥ 80% AND high+medium ≥ 80%): ${flag(ba.meetsBusinessAnnotations80)}`);
  lines.push("");
  lines.push("> Mock provider 是规则引擎,不是 LLM。labelMatch 命中率反映规则覆盖,非\"业务理解\"准确率;");
  lines.push("> 真正的 ≥ 80% 业务翻译质量需 ClaudeProvider + 人工评估,落地于 M1.4 真实 LLM 跑通后。");
  lines.push("");
  // Show worst labelMatch entries for debugging.
  for (const p of ba.perEntry) {
    if (!p.labelMismatches.length) continue;
    lines.push(`### labelMismatches — ${p.entryId} (前 5)`);
    for (const m of p.labelMismatches.slice(0, 5)) {
      lines.push(`- \`${m.nodeId}\`: gt=\`${m.gt}\` ↔ cand=\`${m.cand}\``);
    }
    lines.push("");
  }

  // ---------------- M1 退出条件 ----------------
  const sgPass = sg.recall >= 0.8;
  const ioPass = io.accuracy >= 1;
  const flowPass = mainPathOk;
  const allMustPass = sgPass && ioPass && flowPass;
  lines.push("## 5. M1 退出条件汇总");
  lines.push("");
  lines.push(`| 验收项 | 阈值 | 实际 | 结果 |`);
  lines.push(`|---|---|---|---|`);
  lines.push(`| SymbolGraph 召回 | ≥ 80% | ${pct(sg.recall)} | ${flag(sgPass)} |`);
  lines.push(`| IOEntryRegistry 准确 | = 100% | ${pct(io.accuracy)} | ${flag(ioPass)} |`);
  lines.push(`| FlowGraph 主路径覆盖 | ≥ 80% | ${pct(avgFlowNode)} | ${flag(flowPass)} |`);
  lines.push(`| BusinessAnnotations(mock 自动近似) | ≥ 80% | ${pct(ba.avgLabelMatchRate)} | ${flag(ba.meetsBusinessAnnotations80)} (不阻塞 M1 退出 — 需真实 LLM) |`);
  lines.push("");
  lines.push(`**整体(SymbolGraph / IO / FlowGraph 三项 hard requirement)**: ${flag(allMustPass)}`);
  return lines.join("\n") + "\n";
}

async function main(): Promise<void> {
  const projectRoot = process.argv[2] ?? resolve(__dirname, "../../../fixtures/fixture-a-order-app/backend");
  const groundTruthDir = resolve(projectRoot, "..", "ground-truth");
  const outDir = resolve(__dirname, "../../../reports/m1-out");
  const reportFile = resolve(__dirname, "../../../reports/m1-accuracy.md");
  const report = await runPipeline({ projectRoot, groundTruthDir, outDir, reportFile });
  const md = renderReport(report);
  if (!existsSync(dirname(reportFile))) mkdirSync(dirname(reportFile), { recursive: true });
  writeFileSync(reportFile, md, "utf8");
  // eslint-disable-next-line no-console
  console.log(`wrote ${reportFile}`);

  // Exit code: fail if any of the three hard requirements miss.
  const sgPass = report.symbolGraph.recall >= 0.8;
  const ioPass = report.ioRegistry.accuracy >= 1;
  const flowPass = report.flowGraphs.every(
    (f) => f.nodeCoverage >= 0.8 && f.edgeCoverage >= 0.8 && f.writeReadTableCoverage >= 0.8
  );
  if (!(sgPass && ioPass && flowPass)) {
    // eslint-disable-next-line no-console
    console.error(`HARD requirement missed — see ${reportFile}`);
    process.exit(1);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
