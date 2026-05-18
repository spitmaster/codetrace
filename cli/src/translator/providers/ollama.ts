import { LLMProvider, TranslateRequest } from "../provider";

// Ollama provider for M1.4 — currently a STUB that throws when invoked.
// Real implementation will POST to /api/chat against a local ollama server
// (default http://localhost:11434) and parse the JSON-mode response. M1.4
// will fill in the body.
//
// Why we keep a separate file (not just a `provider="claude"` config):
// SPEC §M1 functional req 4 mandates that the Provider abstraction supports
// at least Claude + Ollama — having a second concrete class proves the
// abstraction holds even without any real Ollama traffic yet.
export class OllamaProvider implements LLMProvider {
  readonly id = "ollama";

  constructor(
    private readonly opts: { endpoint?: string; model?: string } = {}
  ) {}

  async translate(_req: TranslateRequest): ReturnType<LLMProvider["translate"]> {
    throw new Error(
      `OllamaProvider not implemented yet — landing in M1.4. ` +
        `Configured endpoint="${this.opts.endpoint ?? "http://localhost:11434"}", ` +
        `model="${this.opts.model ?? "(default)"}".`
    );
  }
}
