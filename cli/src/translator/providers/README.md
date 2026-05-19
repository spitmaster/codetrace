# Business-Translator Providers

Four backends implement `LLMProvider`. They share the same prompt template
(`../prompt.ts` → `ts-express-prisma@v1`) and the same red-line guardrails
(empty evidence → `confidence=low` + 占位 label; schema rejects empty
`evidence[]`). Pick by what you have on hand.

| Provider     | id            | Needs API key?       | Needs local `claude` CLI? | Cost / call       | Latency  | CI friendly? | Quality       |
|--------------|---------------|----------------------|---------------------------|-------------------|----------|--------------|---------------|
| `MockProvider`       | `mock`        | no                   | no                        | $0                | <10 ms   | YES (default) | Rule-based, ~44% labelMatch |
| `ClaudeProvider`     | `claude`      | YES (`ANTHROPIC_API_KEY`) | no                   | ~$0.30 (Opus)     | ~3-6 s   | If key in secrets | Highest |
| `OllamaProvider`     | `ollama`      | no                   | no (needs ollama server)  | $0                | varies   | Only with local ollama in CI | Local-model dependent |
| `ClaudeCodeProvider` | `claude-code` | NO (reuses OAuth)    | YES (`claude` on PATH)    | ~$0.30 (sub quota)| ~7-12 s  | NO (requires interactive auth) | Same model class as `claude` |

## When to pick which

- **CI / regression tests** → `mock`. Offline, deterministic, no external
  state. SPEC §7 hard requirements (SymbolGraph / IO / FlowGraph) are
  validated against `mock`. The BusinessAnnotations 80% bar is reported but
  not enforced under `mock`.
- **Production CLI with API budget** → `claude`. Set
  `ANTHROPIC_API_KEY`; predictable rate limits; works in headless servers.
- **Local development on a Claude.ai subscription** → `claude-code`. No key
  shuffling; uses the same OAuth that powers your interactive Claude Code
  session. Costs subscription quota, not a separate API budget. Slower per
  call (~4 s spawn overhead) and harder to use in CI.
- **Air-gapped or self-hosted** → `ollama` with a local 7B-or-larger model.
  Quality is model-dependent; structured-output reliability is the weak link
  (we set `format: "json"` but local models still sometimes wrap output in
  prose).

## Red line #2 is enforced in three places

1. Prompt template tells the model to set `confidence=low` + `占位:` label
   when evidence is empty.
2. Every provider short-circuits or carries an "evidence empty →
   placeholder" code path (mock and claude-code do this *before* calling
   the model; claude/ollama rely on the prompt + schema enforcement).
3. `BusinessAnnotationsSchema.parse()` rejects any annotation whose
   `evidence[]` is empty.

If you write a new provider, you must honour all three layers — see how
`claude-code.ts` does it with `hasAnyEvidence` + `buildPlaceholderAnnotations`.
