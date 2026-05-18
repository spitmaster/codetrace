import { BusinessAnnotationsSchema, SCHEMA_VERSION } from "../../schemas";
import { LLMProvider, TranslateRequest } from "../provider";

// Claude provider for M1.4 — currently a STUB that throws when invoked.
// Real implementation will use @anthropic-ai/sdk and stream the FlowGraph +
// evidence into a few-shot prompt; the SDK + prompt design lands in M1.4.
//
// Why stub now: the abstraction shape (TranslateRequest → BusinessAnnotations)
// must be settled before M1.5 web frontend can consume it, even if no real
// API call is wired yet. This stub is what downstream code (orchestrator,
// CLI, tests) imports — replacing the body is a one-file change in M1.4.
export class ClaudeProvider implements LLMProvider {
  readonly id = "claude";

  constructor(
    // The constructor signature is finalized so M1.4 implementation just fills
    // in the body. apiKey may be read from process.env.ANTHROPIC_API_KEY when
    // not provided.
    private readonly opts: { apiKey?: string; model?: string } = {}
  ) {}

  async translate(_req: TranslateRequest): ReturnType<LLMProvider["translate"]> {
    // M1.4 will replace this body with @anthropic-ai/sdk calls. For now we
    // surface a clear NotImplemented error so callers do not silently emit
    // empty BusinessAnnotations (which would risk red line #2).
    throw new Error(
      `ClaudeProvider not implemented yet — landing in M1.4. ` +
        `Configured model="${this.opts.model ?? "(default)"}". ` +
        `Use a mock provider in tests via makeProviderRegistry([new MockProvider()]).`
    );
  }
}

// Smoke export so unused-import lint rules don't trip on a fresh M1.4 file.
export const _ASSERTING_SCHEMA = {
  schemaVersion: SCHEMA_VERSION,
  parse: BusinessAnnotationsSchema.parse,
};
