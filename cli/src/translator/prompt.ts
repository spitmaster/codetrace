/**
 * Prompt assembly for the LLM-backed business-translator providers.
 *
 * Per docs/agents/business-translator.md §"Prompt 工程组织原则", prompts are
 * organised by language × framework. M1 only ships the TS+Express+Prisma
 * template. M2 (Java Spring / Vue3) will add sibling templates.
 *
 * Why a shared module: both ClaudeProvider and OllamaProvider need the SAME
 * prompt structure so that A/B comparison between them is meaningful. If each
 * had its own prompt we'd be conflating "Claude vs Ollama" with "prompt A vs
 * prompt B". This module is the single source of truth.
 *
 * Anti-fabrication guarantees encoded in the prompt:
 *   1. The output schema requires evidence[] non-empty for every annotation.
 *   2. Explicit instruction: "If the evidence list for a node/edge is empty
 *      you MUST set confidence='low' and businessLabel to the placeholder
 *      '占位:...'. Do not infer business meaning from function names alone."
 *   3. The model is asked to ECHO the evidence verbatim from the
 *      `evidenceByNode` / `evidenceByEdge` inputs, not to invent new ones.
 */
import { FlowGraph } from "../schemas";
import { TranslateRequest } from "./provider";

export const PROMPT_VERSION = "ts-express-prisma@v1";

interface CompactedFlow {
  entryId: string;
  nodeCount: number;
  edgeCount: number;
  nodes: Array<{
    id: string;
    kind: string;
    label: string;
    metadata?: Record<string, unknown>;
    evidence: string[];
  }>;
  edges: Array<{
    id: string;
    from: string;
    to: string;
    kind: string;
    metadata?: Record<string, unknown>;
    evidence: string[];
  }>;
}

function compactFlow(req: TranslateRequest): CompactedFlow {
  const { flow, evidenceByNode, evidenceByEdge } = req;
  return {
    entryId: flow.entryId,
    nodeCount: flow.nodes.length,
    edgeCount: flow.edges.length,
    nodes: flow.nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      label: n.label,
      metadata: n.metadata,
      evidence: evidenceByNode[n.id] ?? [],
    })),
    edges: flow.edges.map((e) => ({
      id: e.id,
      from: e.from,
      to: e.to,
      kind: e.kind,
      metadata: e.metadata,
      evidence: evidenceByEdge[e.id] ?? [],
    })),
  };
}

const SYSTEM = `你是熟悉 TypeScript + Express + Prisma 技术栈的资深后端工程师,被要求把代码事实翻译成程序员一眼能懂的中文业务语言。

输出对象是 BusinessAnnotations schema 0.1.0,JSON 格式,严格符合给定 schema:
{
  "schemaVersion": "0.1.0",
  "entryId": <从输入复制>,
  "narrative": <2-5 句中文业务流水叙述>,
  "narrativeConfidence": "high" | "medium" | "low",
  "narrativeEvidence": <字符串数组,至少 1 项>,
  "nodeAnnotations": [
    {
      "nodeId": <节点 id>,
      "businessLabel": <≤ 12 字中文标签>,
      "businessDescription": <≤ 60 字中文一句话,可选>,
      "confidence": "high" | "medium" | "low",
      "evidence": <从输入 evidence 中复制,不允许新增字段>
    }
  ],
  "edgeAnnotations": [
    {
      "edgeId": <边 id>,
      "businessLabel": <≤ 12 字中文标签>,
      "confidence": "high" | "medium" | "low",
      "evidence": <从输入 evidence 中复制>
    }
  ]
}

强约束(违反任何一条直接驳回):
1. 不许臆造业务含义。businessLabel 必须能从输入的 evidence + metadata 推导;只看函数名臆造的合理解释一律不允许。
2. 如果某节点/边的 evidence 数组为空,businessLabel 必须以 "占位:" 开头,confidence 必须是 low,不许猜测。
3. evidence 字段必须从输入 evidence 中按原文复制(去重可以,改写不可以)。如果输入 evidence 为空,evidence 输出至少包含一项 "(no evidence — placeholder)"。
4. metadata.ormCall 提示 Prisma 调用:findUnique/findFirst/findMany = 读;create/createMany = 写;update/updateMany = 改写;delete/deleteMany = 删;count/aggregate = 统计。
5. metadata.model 提示数据表(User=用户表,Product=商品表,Order=订单表,OrderItem=订单行表)。
6. metadata.role=middleware 的函数视为中间件;requireUser 的语义是鉴权(校验 x-user-id)。
7. metadata.kind=handler 的函数是 HTTP 入口,标签格式 "<METHOD> <path> 接口入口"。
8. narrative 必须串成 2-5 句连贯中文,体现:鉴权 → 业务编排 → 关键写动作(若有)→ 返回。绝不简单拼接节点标签。

输出只允许是单一 JSON 对象(不要 markdown 代码块包裹,不要多余文字)。`;

const USER_HEADER = `请把以下 FlowGraph 翻译为 BusinessAnnotations。FlowGraph(含每节点/边的 evidence)序列化如下:`;

export function buildClaudePrompt(req: TranslateRequest): {
  system: string;
  user: string;
} {
  const compact = compactFlow(req);
  const docs = req.contextDocs?.length
    ? `\n\n附加项目上下文(节选):\n${req.contextDocs.join("\n---\n")}`
    : "";
  const user =
    USER_HEADER +
    "\n\n```json\n" +
    JSON.stringify(compact, null, 2) +
    "\n```" +
    docs;
  return { system: SYSTEM, user };
}

/**
 * Ollama uses a single prompt string (chat mode also exists but generate is
 * the lowest common denominator across local backends). We concatenate
 * system + user with a clear separator.
 */
export function buildOllamaPrompt(req: TranslateRequest): string {
  const { system, user } = buildClaudePrompt(req);
  return `<<<SYSTEM>>>\n${system}\n\n<<<USER>>>\n${user}\n\n<<<ASSISTANT>>>\n`;
}

/** Exported for unit tests — let them assert prompt shape without calling SDK. */
export const _internals = {
  compactFlow,
  SYSTEM,
  USER_HEADER,
  PROMPT_VERSION,
};

// Smoke import so FlowGraph type stays referenced and is not tree-shaken in
// type-only contexts; also documents the dependency.
export type { FlowGraph } from "../schemas";
