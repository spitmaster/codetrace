/**
 * ClaudeProvider — Anthropic API-backed business-translator implementation.
 *
 * Trade-offs that drove this shape:
 *  - The SDK (@anthropic-ai/sdk) is loaded LAZILY at translate() time via
 *    `require("@anthropic-ai/sdk")`. Rationale: keeping the dep optional means
 *    contributors can run `npm test` / e2e with MockProvider without
 *    pulling Anthropic's SDK + transitive deps. Type-only imports also fail
 *    when the package isn't installed, so we use dynamic require.
 *  - apiKey resolution: explicit constructor opt > ANTHROPIC_API_KEY env.
 *    Missing key → clear error before any network call (per CLAUDE.md
 *    sensitive-config etiquette).
 *  - JSON-mode parsing: Anthropic doesn't have native "json_schema" output
 *    yet. We instruct the prompt to return raw JSON and parse defensively
 *    (strip ```json fences, then JSON.parse). On parse failure we fall back
 *    to an explicit error rather than silently emitting a degenerate result.
 *  - schema validation: every successful translate() pipes the model output
 *    through BusinessAnnotationsSchema.parse so red line #2 (evidence
 *    non-empty) is enforced even when the LLM is sloppy.
 */
import { BusinessAnnotations, BusinessAnnotationsSchema } from "../../schemas";
import { LLMProvider, TranslateRequest } from "../provider";
import { buildClaudePrompt } from "../prompt";

interface ClaudeOpts {
  apiKey?: string;
  model?: string;
  /** Override for tests / proxies; default = SDK default. */
  baseUrl?: string;
  /** Max output tokens; sized for ~1500 LoC FlowGraphs in M1. */
  maxTokens?: number;
}

// Anthropic SDK type fragment we depend on. Kept narrow so we can mock it in
// tests without pulling the SDK as a hard dep.
interface AnthropicSDK {
  messages: {
    create(req: {
      model: string;
      max_tokens: number;
      system?: string;
      messages: Array<{ role: "user" | "assistant"; content: string }>;
    }): Promise<{
      content: Array<{ type: string; text?: string }>;
    }>;
  };
}

type AnthropicCtor = new (opts: { apiKey: string; baseURL?: string }) => AnthropicSDK;

export class ClaudeProvider implements LLMProvider {
  readonly id = "claude";

  // Allow test injection. If left undefined we resolve from @anthropic-ai/sdk
  // at translate() time.
  private clientFactory?: () => AnthropicSDK;

  constructor(private readonly opts: ClaudeOpts = {}) {}

  /**
   * Inject a pre-built SDK client (test seam). Production code does not call
   * this — translate() will lazy-load the real SDK if no factory is set.
   */
  withClient(factory: () => AnthropicSDK): this {
    this.clientFactory = factory;
    return this;
  }

  private resolveApiKey(): string {
    const k = this.opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!k) {
      throw new Error(
        `ClaudeProvider: ANTHROPIC_API_KEY missing. Set the env var or pass apiKey ` +
          `in constructor. To run without a real key, use MockProvider instead.`
      );
    }
    return k;
  }

  private getClient(): AnthropicSDK {
    if (this.clientFactory) return this.clientFactory();
    // Resolve API key BEFORE loading SDK — gives users the friendlier "set
    // ANTHROPIC_API_KEY" error rather than "install SDK" error when both
    // are missing.
    const apiKey = this.resolveApiKey();
    let mod: { default?: AnthropicCtor } | AnthropicCtor;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      mod = require("@anthropic-ai/sdk");
    } catch (err) {
      throw new Error(
        `ClaudeProvider: @anthropic-ai/sdk is not installed. Install it via ` +
          `\`npm install --prefix cli @anthropic-ai/sdk\` and retry. ` +
          `Underlying error: ${(err as Error).message}`
      );
    }
    const Ctor: AnthropicCtor =
      typeof mod === "function" ? (mod as AnthropicCtor) : (mod.default ?? (mod as unknown as AnthropicCtor));
    return new Ctor({ apiKey, baseURL: this.opts.baseUrl });
  }

  async translate(req: TranslateRequest): Promise<BusinessAnnotations> {
    const client = this.getClient();
    const { system, user } = buildClaudePrompt(req);
    const model = this.opts.model ?? "claude-opus-4-7";
    const maxTokens = this.opts.maxTokens ?? 4096;

    const resp = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    });

    const text = (resp.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n")
      .trim();

    const json = extractJson(text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (err) {
      throw new Error(
        `ClaudeProvider: model returned non-JSON output. First 200 chars: ${text.slice(
          0,
          200
        )}. Underlying parse error: ${(err as Error).message}`
      );
    }
    // schema-level red line enforcement (evidence non-empty etc.)
    return BusinessAnnotationsSchema.parse(parsed);
  }
}

/**
 * Strip common LLM wrappers (```json fences, leading prose) and return the
 * largest balanced JSON object substring we can find.
 *
 * Why not just trust the model: even with explicit "return raw JSON" prompt,
 * Claude sometimes prefixes "Here is the JSON:". The defensive extraction
 * keeps the provider usable while we iterate on prompt phrasing.
 */
export function extractJson(text: string): string {
  // Code fence stripping.
  const fenced = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fenced) return fenced[1].trim();

  // Find first '{' and last '}' as a lazy balance.
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) return text.slice(first, last + 1);
  return text.trim();
}
