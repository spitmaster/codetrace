/**
 * MockProvider — heuristic, no-LLM business translator.
 *
 * Role in M1.4:
 *  - End-to-end pipeline must run *offline*, including in CI where no LLM API
 *    keys are available. MockProvider produces a deterministic, rule-based
 *    BusinessAnnotations from a FlowGraph + evidence map.
 *  - It is NOT a quality bar — accuracy against the four ground-truth files
 *    will be reported by the evaluator and is expected to be below the SPEC §7
 *    80% target. Real ≥80% requires ClaudeProvider with a key (M1.4 final
 *    landing, gated by user).
 *  - Red line #2 (no fabrication) still applies: when the per-node evidence
 *    array is empty, the annotation MUST be confidence=low with a placeholder
 *    label. The rules below honor that even though we are not an LLM.
 *
 * Heuristic catalogue (FlowGraph → annotation):
 *   - input:                                       "请求入口"               (high if evidence)
 *   - response (metadata.httpStatus/httpMethod):   "返回 <status>"          (high)
 *   - function role=middleware (requireUser):     "鉴权"                   (high)
 *   - function kind=handler:                       "<METHOD> <path> 接口入口"(high)
 *   - function role=service / txScoped:           "<func>(服务编排)"        (medium)
 *   - function metadata.ormCall=prisma.X.find*:   "读取 <X 表>"            (high)
 *   - function metadata.ormCall=prisma.X.create*: "写入 <X 表>"            (high)
 *   - function metadata.ormCall=prisma.X.update:  "更新 <X 表>"            (high)
 *   - function metadata.ormCall=prisma.X.delete:  "删除 <X 表>"            (high)
 *   - function metadata.ormCall=prisma.X.count:   "统计 <X 表>"            (high)
 *   - function (everything else):                  "<func>(函数)"            (medium)
 *   - table (metadata.model):                      "<中文表名>表"           (high)
 *
 * Why these rules: every Fixture-A node carries enough structural metadata
 * (ormCall, model, role, kind) that we never need to guess from the function
 * name alone. The label format mirrors the ground-truth style ("写入订单表",
 * "读取商品表"). businessDescription is left empty for nodes where evidence
 * doesn't give us anything semantic to add — we'd rather be terse than
 * fabricate.
 */
import { BusinessAnnotations, FlowGraph } from "../../schemas";
import { LLMProvider, TranslateRequest } from "../provider";

// Chinese table-name map. Centralised so ClaudeProvider can reuse on cache
// miss when LLM degrades, and so the evaluator can rate label match.
const TABLE_LABEL: Record<string, string> = {
  User: "用户表",
  Product: "商品表",
  Order: "订单表",
  OrderItem: "订单行表",
};

function tableLabel(model?: string): string {
  if (!model) return "数据表";
  return TABLE_LABEL[model] ?? `${model} 表`;
}

function tableLabelInline(model?: string): string {
  // Inline form used by edges: "读 订单表" reads as "read order table".
  return tableLabel(model);
}

interface NodeMeta {
  role?: string;
  kind?: string; // "handler" | "function" | "middleware"
  ormCall?: string;
  model?: string;
  httpStatus?: number;
  httpMethod?: string;
  transactional?: boolean;
  txScoped?: boolean;
}

function readMeta(m: unknown): NodeMeta {
  if (!m || typeof m !== "object") return {};
  const o = m as Record<string, unknown>;
  return {
    role: typeof o.role === "string" ? o.role : undefined,
    kind: typeof o.kind === "string" ? o.kind : undefined,
    ormCall: typeof o.ormCall === "string" ? o.ormCall : undefined,
    model: typeof o.model === "string" ? o.model : undefined,
    httpStatus: typeof o.httpStatus === "number" ? o.httpStatus : undefined,
    httpMethod: typeof o.httpMethod === "string" ? o.httpMethod : undefined,
    transactional: o.transactional === true,
    txScoped: o.txScoped === true,
  };
}

function parseOrm(orm: string): { model?: string; op?: string } {
  // prisma.<model>.<op>  or  tx.<model>.<op>
  const m = orm.match(/^(?:prisma|tx)\.([a-zA-Z]+)\.([a-zA-Z]+)$/);
  if (!m) return {};
  const rawModel = m[1];
  // Tracer lowercases model in some outputs (e.g. "orderitem"); normalise.
  const normModel = rawModel.replace(/^./, (c) => c.toUpperCase());
  const lookup: Record<string, string> = {
    User: "User",
    Product: "Product",
    Order: "Order",
    Orderitem: "OrderItem",
    OrderItem: "OrderItem",
  };
  const model = lookup[normModel] ?? normModel;
  return { model, op: m[2] };
}

function labelForOrm(orm: string): string | undefined {
  const { model, op } = parseOrm(orm);
  if (!model || !op) return undefined;
  const t = tableLabel(model);
  if (/^find/.test(op)) return `读取${t}`;
  if (/^create/.test(op)) return `写入${t}`;
  if (op === "update" || op === "updateMany") return `更新${t}`;
  if (op === "delete" || op === "deleteMany") return `删除${t}`;
  if (op === "count" || op === "aggregate") return `统计${t}`;
  if (op === "upsert") return `写入${t}`;
  return `${t} ${op}`;
}

function parseEntryId(entryId: string): { method?: string; path?: string } {
  // io:http:METHOD:/path
  const m = entryId.match(/^io:http:([A-Z]+):(.+)$/);
  if (!m) return {};
  return { method: m[1], path: m[2] };
}

function labelForNode(
  node: FlowGraph["nodes"][number],
  entryId: string
): { label: string; description?: string; baseConfidence: "high" | "medium" } {
  const meta = readMeta(node.metadata);
  const { method, path } = parseEntryId(entryId);

  if (node.kind === "input") {
    return { label: "请求入口", description: "外部请求进入系统的入口", baseConfidence: "high" };
  }
  if (node.kind === "response") {
    const status = meta.httpStatus ?? "";
    return {
      label: status ? `返回 ${status}` : "返回响应",
      baseConfidence: "high",
    };
  }
  if (node.kind === "table") {
    return {
      label: tableLabel(meta.model),
      description: meta.model
        ? `持久化表 ${meta.model},承载本链路数据读写`
        : undefined,
      baseConfidence: "high",
    };
  }
  if (node.kind === "function") {
    // 1) Prisma calls first — strongest signal.
    if (meta.ormCall) {
      const l = labelForOrm(meta.ormCall);
      if (l) return { label: l, description: meta.ormCall, baseConfidence: "high" };
    }
    // 2) Handler/middleware.
    if (meta.role === "middleware") {
      // For the canonical "requireUser" we know it's auth; otherwise label by
      // function name to avoid making up semantics.
      const sym = node.symbolId ?? "";
      if (/requireUser$/.test(sym) || /requireUser/.test(node.label)) {
        return { label: "鉴权", description: "校验 x-user-id,缺失则 401", baseConfidence: "high" };
      }
      return { label: `中间件:${node.label}`, baseConfidence: "medium" };
    }
    if (meta.kind === "handler" || / handler$/i.test(node.label)) {
      // Tracer marks handlers with `metadata.kind: "handler"`; ground-truth
      // files use a label-based convention ("POST /api/orders handler"). We
      // accept both so MockProvider works against live tracer output AND
      // against canned ground-truth fixtures (the eval / e2e flow).
      const p = path ?? node.label;
      const m = method ?? "";
      return {
        label: `${m} ${p} 接口入口`,
        description: "HTTP 入口处理函数,把请求转交业务服务并把结果返回客户端",
        baseConfidence: "high",
      };
    }
    // 3) Service / transactional orchestrator.
    if (meta.transactional || meta.txScoped || meta.role === "service") {
      return {
        label: `${node.label}(服务编排)`,
        description: "业务服务函数,负责事务/编排步骤",
        baseConfidence: "medium",
      };
    }
    // 4) Plain function — terse, no guessing.
    return { label: `${node.label}(函数)`, baseConfidence: "medium" };
  }
  // file / external-api / queue — not produced by current tracer but be safe.
  return { label: node.label, baseConfidence: "medium" };
}

function labelForEdge(edge: FlowGraph["edges"][number]): string {
  const meta = (edge.metadata ?? {}) as Record<string, unknown>;
  const target = typeof meta.target === "string" ? meta.target : undefined;
  switch (edge.kind) {
    case "input-bind":
      return "请求绑定";
    case "call":
      return "调用";
    case "read":
      return `读${tableLabelInline(target)}`;
    case "write":
      return `写${tableLabelInline(target)}`;
    case "delete":
      return `删除${tableLabelInline(target)}`;
    case "return":
      return "返回响应";
    case "publish":
      return "发布事件";
    case "http-call":
      return "调用外部 API";
    default:
      return edge.kind;
  }
}

function buildNarrative(flow: FlowGraph, entryId: string): string {
  const { method, path } = parseEntryId(entryId);
  const writes = flow.edges
    .filter((e) => e.kind === "write" || e.kind === "delete")
    .map((e) => {
      const m = (e.metadata ?? {}) as Record<string, unknown>;
      const target = typeof m.target === "string" ? m.target : undefined;
      const verb = e.kind === "write" ? "写入" : "删除";
      return `${verb}${tableLabel(target)}`;
    });
  const reads = flow.edges
    .filter((e) => e.kind === "read")
    .map((e) => {
      const m = (e.metadata ?? {}) as Record<string, unknown>;
      const target = typeof m.target === "string" ? m.target : undefined;
      return `读取${tableLabel(target)}`;
    });
  const uniq = (xs: string[]) => Array.from(new Set(xs));
  const writesU = uniq(writes);
  const readsU = uniq(reads);

  const head =
    method && path ? `用户调用 ${method} ${path} 接口。` : `用户调用入口 ${entryId}。`;
  const auth = flow.nodes.some(
    (n) => (readMeta(n.metadata).role) === "middleware"
  )
    ? "请求先经过鉴权中间件校验 x-user-id;"
    : "";
  const dbReads = readsU.length ? `期间会${readsU.join("、")};` : "";
  const dbWrites = writesU.length ? `并${writesU.join("、")};` : "";
  const noWrites = !writesU.length && !readsU.length ? "全程不触达数据库;" : "";
  const tail = `最终把结果返回客户端。`;

  // Keep it 2-5 sentences as SPEC asks. We collapse the middle into one
  // semicolon-joined line so it still reads naturally.
  const sentences = [head + auth, dbReads + dbWrites + noWrites + tail].filter(Boolean);
  return sentences.join("");
}

function pickConfidence(
  base: "high" | "medium",
  evidence: string[]
): "high" | "medium" | "low" {
  // Red line #2: empty evidence collapses to low + placeholder. We DO NOT
  // upgrade past `base` regardless of evidence richness — mock is allowed to
  // be honest about not really understanding the code.
  if (!evidence.length) return "low";
  return base;
}

export class MockProvider implements LLMProvider {
  readonly id = "mock";

  async translate(req: TranslateRequest): Promise<BusinessAnnotations> {
    const { flow, evidenceByNode, evidenceByEdge } = req;

    const nodeAnnotations = flow.nodes.map((n) => {
      const ev = evidenceByNode[n.id] ?? [];
      const { label, description, baseConfidence } = labelForNode(n, flow.entryId);
      const confidence = pickConfidence(baseConfidence, ev);
      // Red line #2: empty evidence → placeholder label + the synthetic
      // anchor `(no evidence)` so the schema-required evidence[] is non-empty
      // while being honest with the downstream consumer that it's a marker.
      const evidence = ev.length ? ev : ["(no evidence — placeholder, mock provider)"];
      const finalLabel = ev.length ? label : `占位:${n.label}`;
      return {
        nodeId: n.id,
        businessLabel: finalLabel,
        businessDescription: description,
        confidence,
        evidence,
      };
    });

    const edgeAnnotations = flow.edges.map((e) => {
      const ev = evidenceByEdge[e.id] ?? [];
      const label = labelForEdge(e);
      const confidence = pickConfidence(
        // Edges are structurally clear (kind + target) — mock claims `high`
        // when evidence is present.
        "high",
        ev
      );
      const evidence = ev.length ? ev : ["(no evidence — placeholder, mock provider)"];
      return {
        edgeId: e.id,
        businessLabel: ev.length ? label : `占位:${e.kind}`,
        confidence,
        evidence,
      };
    });

    // Narrative is always derivable from the FlowGraph structure (entryId +
    // edges + node roles). Confidence=high *only when at least one node has
    // real evidence*; otherwise medium — same anti-fabrication principle.
    const anyRealEvidence = nodeAnnotations.some((a) => a.confidence !== "low");
    const narrative = buildNarrative(flow, flow.entryId);
    const narrativeEvidence = anyRealEvidence
      ? Array.from(
          new Set(
            nodeAnnotations
              .filter((a) => a.confidence !== "low")
              .flatMap((a) => a.evidence)
          )
        ).slice(0, 8) // cap so downstream display stays compact
      : ["(no evidence — placeholder, mock provider)"];

    return {
      schemaVersion: "0.1.0",
      entryId: flow.entryId,
      narrative,
      narrativeConfidence: anyRealEvidence ? "medium" : "low",
      narrativeEvidence,
      nodeAnnotations,
      edgeAnnotations,
    };
  }
}
