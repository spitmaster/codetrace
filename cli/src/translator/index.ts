/**
 * business-translator entry point.
 *
 * Public surface:
 *   - LLMProvider / ProviderRegistry / makeProviderRegistry: provider abstraction
 *   - MockProvider: deterministic, offline, used in tests + CI + e2e mock-run
 *   - ClaudeProvider: real @anthropic-ai/sdk call (requires ANTHROPIC_API_KEY)
 *   - OllamaProvider: real HTTP call to a local ollama server
 *   - buildEvidenceFromFlow: deterministic evidence-extraction from FlowGraph
 *     metadata. Used by CLI / e2e when the upstream tracer doesn't already
 *     ship an evidence map.
 *   - translate(): convenience helper that wires it all together.
 *
 * Red line #2 is enforced THREE TIMES:
 *   1. buildEvidenceFromFlow returns an empty array when metadata is empty
 *      (NEVER fabricates "evidence:" entries).
 *   2. MockProvider/ClaudeProvider/OllamaProvider mark confidence=low when
 *      evidence is empty.
 *   3. BusinessAnnotationsSchema.parse rejects annotations whose evidence[]
 *      is empty — defence in depth.
 */
import { FlowGraph } from "../schemas";
import { LLMProvider, ProviderRegistry, TranslateRequest, makeProviderRegistry } from "./provider";
import { MockProvider } from "./providers/mock";
import { ClaudeProvider } from "./providers/claude";
import { OllamaProvider } from "./providers/ollama";

export type { LLMProvider, ProviderRegistry, TranslateRequest } from "./provider";
export { makeProviderRegistry } from "./provider";
export { MockProvider } from "./providers/mock";
export { ClaudeProvider } from "./providers/claude";
export { OllamaProvider } from "./providers/ollama";
export { buildClaudePrompt, buildOllamaPrompt, PROMPT_VERSION } from "./prompt";

/**
 * Default registry: mock + claude + ollama. Caller can build their own with
 * makeProviderRegistry([...]) if they need a custom configuration (e.g.
 * test-only client injection on ClaudeProvider).
 */
export function defaultRegistry(): ProviderRegistry {
  return makeProviderRegistry([
    new MockProvider(),
    new ClaudeProvider(),
    new OllamaProvider(),
  ]);
}

/**
 * Build an evidence map from a FlowGraph's own metadata. This is the
 * "static" evidence — facts the tracer already knows (symbolId, site:line,
 * ormCall, target table). For richer evidence (file contents, README
 * excerpts) the caller can merge their own map on top.
 *
 * Per node we include:
 *   - symbolId
 *   - metadata.site.file:line
 *   - metadata.ormCall
 *   - metadata.model (for table nodes)
 *   - metadata.role / kind tags
 * Per edge we include:
 *   - metadata.site.file:line
 *   - metadata.target (table)
 *   - metadata.via (relation expansion path)
 *
 * Empty arrays are returned as empty arrays (NOT placeholder strings) —
 * downstream providers are responsible for handling empties.
 */
export function buildEvidenceFromFlow(flow: FlowGraph): {
  evidenceByNode: Record<string, string[]>;
  evidenceByEdge: Record<string, string[]>;
} {
  const evidenceByNode: Record<string, string[]> = {};
  for (const n of flow.nodes) {
    const items: string[] = [];
    if (n.symbolId) items.push(`symbolId: ${n.symbolId}`);
    const meta = (n.metadata ?? {}) as Record<string, unknown>;
    const site = meta.site as { file?: string; line?: number } | undefined;
    if (site?.file && typeof site.line === "number") {
      items.push(`${site.file}:${site.line}`);
    }
    if (typeof meta.ormCall === "string") items.push(`ormCall: ${meta.ormCall}`);
    if (typeof meta.model === "string") items.push(`model: ${meta.model}`);
    if (typeof meta.role === "string") items.push(`role: ${meta.role}`);
    if (typeof meta.kind === "string") items.push(`kind: ${meta.kind}`);
    if (meta.transactional === true) items.push("transactional: true");
    if (meta.txScoped === true) items.push("txScoped: true");
    if (typeof meta.purpose === "string") items.push(`purpose: ${meta.purpose}`);
    if (typeof meta.httpStatus === "number") items.push(`httpStatus: ${meta.httpStatus}`);
    if (typeof meta.httpMethod === "string") items.push(`httpMethod: ${meta.httpMethod}`);
    if (typeof meta.schemaFile === "string") items.push(`schemaFile: ${meta.schemaFile}`);
    // Headers / query / path params for input nodes — these ARE evidence
    // (the request shape constrains business semantics).
    const headers = Array.isArray(meta.headers) ? (meta.headers as unknown[]).filter((h) => typeof h === "string") : [];
    if (headers.length) items.push(`headers: ${headers.join(", ")}`);
    const queryParams = Array.isArray(meta.queryParams) ? (meta.queryParams as unknown[]).filter((q) => typeof q === "string") : [];
    if (queryParams.length) items.push(`queryParams: ${queryParams.join(", ")}`);
    const pathParams = Array.isArray(meta.pathParams) ? (meta.pathParams as unknown[]).filter((p) => typeof p === "string") : [];
    if (pathParams.length) items.push(`pathParams: ${pathParams.join(", ")}`);
    if (meta.bodyShape && typeof meta.bodyShape === "object") items.push(`bodyShape: ${JSON.stringify(meta.bodyShape)}`);
    if (meta.shape) items.push(`shape: ${typeof meta.shape === "string" ? meta.shape : JSON.stringify(meta.shape)}`);
    evidenceByNode[n.id] = items;
  }
  const evidenceByEdge: Record<string, string[]> = {};
  for (const e of flow.edges) {
    const items: string[] = [];
    const meta = (e.metadata ?? {}) as Record<string, unknown>;
    const site = meta.site;
    if (typeof site === "string") items.push(`site: ${site}`);
    else if (site && typeof site === "object") {
      const sf = (site as { file?: string }).file;
      const sl = (site as { line?: number }).line;
      if (sf && typeof sl === "number") items.push(`${sf}:${sl}`);
    }
    if (typeof meta.target === "string") items.push(`target: ${meta.target}`);
    if (typeof meta.via === "string") items.push(`via: ${meta.via}`);
    if (typeof meta.operation === "string") items.push(`operation: ${meta.operation}`);
    if (typeof meta.where === "string") items.push(`where: ${meta.where}`);
    if (typeof meta.businessRule === "string") items.push(`businessRule: ${meta.businessRule}`);
    if (typeof meta.aggregation === "string") items.push(`aggregation: ${meta.aggregation}`);
    if (typeof meta.stateTransition === "string") items.push(`stateTransition: ${meta.stateTransition}`);
    evidenceByEdge[e.id] = items;
  }
  return { evidenceByNode, evidenceByEdge };
}

/**
 * Convenience one-shot translate.
 *
 * Caller picks a provider (e.g. defaultRegistry().get("mock")) and passes a
 * FlowGraph. We build evidence map deterministically from FlowGraph metadata
 * (caller may override) and dispatch to the provider.
 */
export async function translate(opts: {
  provider: LLMProvider;
  flow: FlowGraph;
  evidenceByNode?: Record<string, string[]>;
  evidenceByEdge?: Record<string, string[]>;
  contextDocs?: string[];
}) {
  const auto = buildEvidenceFromFlow(opts.flow);
  const req: TranslateRequest = {
    flow: opts.flow,
    evidenceByNode: opts.evidenceByNode ?? auto.evidenceByNode,
    evidenceByEdge: opts.evidenceByEdge ?? auto.evidenceByEdge,
    contextDocs: opts.contextDocs,
  };
  return opts.provider.translate(req);
}
