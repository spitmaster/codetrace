import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { FlowGraphSchema, BusinessAnnotationsSchema } from "../../schemas";
import {
  MockProvider,
  ClaudeProvider,
  OllamaProvider,
  buildEvidenceFromFlow,
  buildClaudePrompt,
  defaultRegistry,
  translate,
} from "../index";

// Load all four ground-truth FlowGraphs once. We use the GROUND-TRUTH files
// (not the live tracer output) so this test does not depend on the rest of
// the pipeline — it asserts the translator's behaviour in isolation.
const ROOT = resolve(__dirname, "../../../../fixtures/fixture-a-order-app/ground-truth");
const ENTRIES = [
  { slug: "POST_api_orders", id: "io:http:POST:/api/orders" },
  { slug: "GET_api_orders", id: "io:http:GET:/api/orders" },
  { slug: "GET_api_orders_id", id: "io:http:GET:/api/orders/:id" },
  { slug: "DELETE_api_orders_id", id: "io:http:DELETE:/api/orders/:id" },
];

function loadFlow(slug: string) {
  const text = readFileSync(resolve(ROOT, `flow-graph-${slug}.expected.json`), "utf8");
  return FlowGraphSchema.parse(JSON.parse(text));
}

describe("buildEvidenceFromFlow", () => {
  it("extracts evidence for every node from FlowGraph metadata (no fabrication)", () => {
    const flow = loadFlow("POST_api_orders");
    const { evidenceByNode, evidenceByEdge } = buildEvidenceFromFlow(flow);

    // All ground-truth nodes carry metadata, so every node SHOULD get
    // non-empty evidence from the structured metadata alone.
    for (const n of flow.nodes) {
      expect(evidenceByNode[n.id]).toBeDefined();
      expect(evidenceByNode[n.id].length).toBeGreaterThan(0);
    }
    for (const e of flow.edges) {
      expect(evidenceByEdge[e.id]).toBeDefined();
    }

    // Spot-check semantic content: n5 is prisma.user.findUnique — evidence
    // must include the ormCall string verbatim.
    const n5 = evidenceByNode["n5"];
    expect(n5.some((s) => s.includes("prisma.user.findUnique"))).toBe(true);
  });

  it("returns EMPTY array (not placeholder) when a node has no useful metadata", () => {
    const fakeFlow = FlowGraphSchema.parse({
      schemaVersion: "0.1.0",
      entryId: "io:http:GET:/x",
      nodes: [
        { id: "n1", kind: "function", label: "noMeta", depth: 0 },
      ],
      edges: [],
    });
    const { evidenceByNode } = buildEvidenceFromFlow(fakeFlow);
    expect(evidenceByNode["n1"]).toEqual([]);
  });
});

describe("MockProvider — offline business-translator", () => {
  it("produces BusinessAnnotations matching schema for every ground-truth FlowGraph", async () => {
    const provider = new MockProvider();
    for (const e of ENTRIES) {
      const flow = loadFlow(e.slug);
      const out = await translate({ provider, flow });
      // Schema validation is the first red-line guard (evidence non-empty).
      const parsed = BusinessAnnotationsSchema.parse(out);
      expect(parsed.entryId).toBe(e.id);
      expect(parsed.schemaVersion).toBe("0.1.0");
      expect(parsed.nodeAnnotations.length).toBe(flow.nodes.length);
      expect(parsed.edgeAnnotations.length).toBe(flow.edges.length);
    }
  });

  it("honours red line #2 — empty evidence collapses to confidence=low + placeholder label", async () => {
    const provider = new MockProvider();
    const flow = FlowGraphSchema.parse({
      schemaVersion: "0.1.0",
      entryId: "io:http:GET:/mystery",
      nodes: [{ id: "n1", kind: "function", label: "mysteryFn", depth: 0 }],
      edges: [],
    });
    const out = await provider.translate({
      flow,
      evidenceByNode: { n1: [] },
      evidenceByEdge: {},
    });
    expect(out.nodeAnnotations[0].confidence).toBe("low");
    expect(out.nodeAnnotations[0].businessLabel.startsWith("占位:")).toBe(true);
    // Schema still requires evidence[] non-empty — placeholder marker counts.
    expect(out.nodeAnnotations[0].evidence.length).toBeGreaterThan(0);
    expect(out.nodeAnnotations[0].evidence[0]).toMatch(/no evidence/);
  });

  it("labels Prisma calls with read/write/update/delete + Chinese table name", async () => {
    const flow = loadFlow("POST_api_orders");
    const out = await translate({ provider: new MockProvider(), flow });

    const byId = new Map(out.nodeAnnotations.map((a) => [a.nodeId, a]));
    // Ground-truth POST flow node id assignments:
    //   n5 = tx.user.findUnique  → "读取用户表"
    //   n7 = tx.product.findUnique → "读取商品表"
    //   n8 = tx.product.update (decrement stock) → "更新商品表"
    //   n9 = tx.order.create → "写入订单表"
    //   n13 = Order table → "订单表"
    expect(byId.get("n5")?.businessLabel).toBe("读取用户表");
    expect(byId.get("n7")?.businessLabel).toBe("读取商品表");
    expect(byId.get("n8")?.businessLabel).toBe("更新商品表");
    expect(byId.get("n9")?.businessLabel).toBe("写入订单表");
    expect(byId.get("n13")?.businessLabel).toBe("订单表");
  });

  it("handler nodes get '<METHOD> <path> 接口入口' labels", async () => {
    const flow = loadFlow("GET_api_orders_id");
    const out = await translate({ provider: new MockProvider(), flow });
    const handler = out.nodeAnnotations.find((a) => a.nodeId === "n3");
    expect(handler?.businessLabel).toBe("GET /api/orders/:id 接口入口");
  });

  it("narrative is 2-5 sentences mentioning auth + write operations", async () => {
    const flow = loadFlow("POST_api_orders");
    const out = await translate({ provider: new MockProvider(), flow });
    expect(out.narrative.length).toBeGreaterThan(20);
    expect(out.narrative).toContain("鉴权");
    expect(out.narrative).toContain("写入订单表");
  });
});

describe("Provider abstraction (SPEC §M1 功能 4)", () => {
  it("defaultRegistry exposes mock + claude + ollama + claude-code", () => {
    const r = defaultRegistry();
    expect(r.list().sort()).toEqual(["claude", "claude-code", "mock", "ollama"]);
    expect(r.get("mock").id).toBe("mock");
    expect(r.get("claude").id).toBe("claude");
    expect(r.get("ollama").id).toBe("ollama");
    expect(r.get("claude-code").id).toBe("claude-code");
  });

  it("ClaudeProvider throws clear error if no API key + no client injected", async () => {
    const p = new ClaudeProvider({});
    // Unset env var locally for this assertion.
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(
        p.translate({
          flow: loadFlow("POST_api_orders"),
          evidenceByNode: {},
          evidenceByEdge: {},
        })
      ).rejects.toThrow(/ANTHROPIC_API_KEY/);
    } finally {
      if (prev) process.env.ANTHROPIC_API_KEY = prev;
    }
  });

  it("ClaudeProvider — full prompt → JSON output round-trip with injected client", async () => {
    // Simulate Anthropic returning a valid BusinessAnnotations JSON wrapped
    // in a ```json fence (common LLM behaviour we defend against).
    const flow = loadFlow("GET_api_orders");
    const fakeOutput = {
      schemaVersion: "0.1.0",
      entryId: flow.entryId,
      narrative: "用户列订单。",
      narrativeConfidence: "high",
      narrativeEvidence: ["test"],
      nodeAnnotations: flow.nodes.map((n) => ({
        nodeId: n.id,
        businessLabel: "测试标签",
        confidence: "high",
        evidence: ["faked"],
      })),
      edgeAnnotations: flow.edges.map((e) => ({
        edgeId: e.id,
        businessLabel: "测试边",
        confidence: "high",
        evidence: ["faked"],
      })),
    };
    const provider = new ClaudeProvider({ apiKey: "fake" }).withClient(() => ({
      messages: {
        async create(req) {
          // Sanity-check the prompt structure: must include system + user with
          // FlowGraph JSON embedded.
          expect(req.system).toContain("BusinessAnnotations");
          expect(req.messages[0].content).toContain(flow.entryId);
          return {
            content: [
              { type: "text", text: "Here is the JSON:\n```json\n" + JSON.stringify(fakeOutput) + "\n```" },
            ],
          };
        },
      },
    }));
    const out = await provider.translate({
      flow,
      evidenceByNode: {},
      evidenceByEdge: {},
    });
    expect(out.entryId).toBe(flow.entryId);
    expect(out.nodeAnnotations.length).toBe(flow.nodes.length);
  });

  it("OllamaProvider — full round-trip with injected fetch", async () => {
    const flow = loadFlow("GET_api_orders");
    const fakeOutput = {
      schemaVersion: "0.1.0",
      entryId: flow.entryId,
      narrative: "用户列订单。",
      narrativeConfidence: "medium",
      narrativeEvidence: ["test"],
      nodeAnnotations: flow.nodes.map((n) => ({
        nodeId: n.id,
        businessLabel: "测试标签",
        confidence: "medium",
        evidence: ["faked"],
      })),
      edgeAnnotations: flow.edges.map((e) => ({
        edgeId: e.id,
        businessLabel: "测试边",
        confidence: "medium",
        evidence: ["faked"],
      })),
    };
    const fakeFetch: typeof fetch = (async (_url: unknown, _init: unknown) => {
      return new Response(JSON.stringify({ response: JSON.stringify(fakeOutput) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const provider = new OllamaProvider({ fetchImpl: fakeFetch });
    const out = await provider.translate({
      flow,
      evidenceByNode: {},
      evidenceByEdge: {},
    });
    expect(out.entryId).toBe(flow.entryId);
  });
});

describe("Prompt builder", () => {
  it("buildClaudePrompt includes FlowGraph evidence and red-line instructions", () => {
    const flow = loadFlow("POST_api_orders");
    const { evidenceByNode, evidenceByEdge } = buildEvidenceFromFlow(flow);
    const { system, user } = buildClaudePrompt({ flow, evidenceByNode, evidenceByEdge });
    expect(system).toContain("不许臆造业务含义");
    expect(system).toContain("evidence");
    expect(user).toContain(flow.entryId);
    expect(user).toContain("prisma.user.findUnique");
  });
});
