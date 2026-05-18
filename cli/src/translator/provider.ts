import { BusinessAnnotations, FlowGraph } from "../schemas";

export interface TranslateRequest {
  flow: FlowGraph;
  // Source-code-grounded evidence: for each node and edge, a list of evidence
  // strings (e.g. "src/services/order-service.ts:33 tx.user.findUnique(...)")
  // already pre-extracted by the dataflow tracer / static analyzer. Empty
  // evidence forces the translator to emit confidence=low and a placeholder
  // label — never to fabricate.
  evidenceByNode: Record<string, string[]>;
  evidenceByEdge: Record<string, string[]>;
  // High-level project intent text (e.g. backend/README.md §4) the translator
  // may consult to produce the narrative. Optional.
  contextDocs?: string[];
}

export interface LLMProvider {
  /** Provider id, used in logs and config (e.g. "claude" | "ollama"). */
  readonly id: string;
  /**
   * Translate one FlowGraph into BusinessAnnotations. Must obey codeviz
   * red line #2: if evidence for a node/edge is empty, the annotation must
   * be marked `confidence=low` with a placeholder label and the evidence
   * array repeated empty — i.e. never fabricate.
   */
  translate(req: TranslateRequest): Promise<BusinessAnnotations>;
}

export interface ProviderRegistry {
  get(id: string): LLMProvider;
  list(): string[];
}

class StaticRegistry implements ProviderRegistry {
  constructor(private providers: Map<string, LLMProvider>) {}
  get(id: string): LLMProvider {
    const p = this.providers.get(id);
    if (!p) {
      throw new Error(
        `unknown LLM provider: "${id}"; available: ${[...this.providers.keys()].join(", ")}`
      );
    }
    return p;
  }
  list(): string[] {
    return [...this.providers.keys()];
  }
}

export function makeProviderRegistry(providers: LLMProvider[]): ProviderRegistry {
  const map = new Map<string, LLMProvider>();
  for (const p of providers) {
    if (map.has(p.id)) {
      throw new Error(`duplicate provider id: ${p.id}`);
    }
    map.set(p.id, p);
  }
  return new StaticRegistry(map);
}
