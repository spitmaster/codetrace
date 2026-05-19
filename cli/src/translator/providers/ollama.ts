/**
 * OllamaProvider — local-model business-translator implementation.
 *
 * Why this exists: SPEC §M1 功能 4 mandates that the Provider abstraction
 * supports BOTH Claude AND Ollama. Having a working local fallback also
 * matters for offline / air-gapped users.
 *
 * Implementation notes:
 *  - Uses the /api/generate REST endpoint (default http://localhost:11434).
 *    /api/chat is also available but generate is the most universally
 *    supported across local backends (llama.cpp wrappers etc.).
 *  - `format: "json"` flag in Ollama coerces the model to JSON output. We
 *    still defensively strip ``` fences via the same extractJson helper.
 *  - No dependency on any SDK: plain fetch(). Node ≥ 18 has global fetch.
 *  - On connection failure we surface a clear "is ollama running" message so
 *    users don't blame the translator.
 */
import { BusinessAnnotations, BusinessAnnotationsSchema } from "../../schemas";
import { LLMProvider, TranslateRequest } from "../provider";
import { buildOllamaPrompt } from "../prompt";
import { extractJson } from "./claude";

interface OllamaOpts {
  endpoint?: string;
  model?: string;
  /** Test seam: inject a custom fetch (e.g. for unit tests). */
  fetchImpl?: typeof fetch;
}

export class OllamaProvider implements LLMProvider {
  readonly id = "ollama";

  constructor(private readonly opts: OllamaOpts = {}) {}

  async translate(req: TranslateRequest): Promise<BusinessAnnotations> {
    const endpoint = (this.opts.endpoint ?? "http://localhost:11434").replace(/\/+$/, "");
    const model = this.opts.model ?? "qwen2.5:7b-instruct";
    const prompt = buildOllamaPrompt(req);
    const url = `${endpoint}/api/generate`;
    const fetchImpl = this.opts.fetchImpl ?? fetch;

    let resp: Response;
    try {
      resp = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          format: "json",
          options: { temperature: 0.1 },
        }),
      });
    } catch (err) {
      throw new Error(
        `OllamaProvider: cannot reach ${url}. Is ollama running? ` +
          `Underlying error: ${(err as Error).message}`
      );
    }
    if (!resp.ok) {
      const body = await resp.text().catch(() => "(unreadable)");
      throw new Error(
        `OllamaProvider: HTTP ${resp.status} from ${url}. Body: ${body.slice(0, 300)}`
      );
    }
    const body = (await resp.json()) as { response?: string };
    const text = (body.response ?? "").trim();
    if (!text) {
      throw new Error("OllamaProvider: empty response body");
    }
    const json = extractJson(text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (err) {
      throw new Error(
        `OllamaProvider: model returned non-JSON output. First 200 chars: ${text.slice(
          0,
          200
        )}. Underlying parse error: ${(err as Error).message}`
      );
    }
    return BusinessAnnotationsSchema.parse(parsed);
  }
}
