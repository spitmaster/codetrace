/**
 * ClaudeCodeProvider — drives the local `claude` CLI (Claude Code) as a
 * business-translator LLM backend.
 *
 * Why this provider exists alongside ClaudeProvider:
 *  - ClaudeProvider talks to the Anthropic REST API and REQUIRES an
 *    ANTHROPIC_API_KEY. That is the right shape for CI, server deployments,
 *    or users who already have an API budget.
 *  - ClaudeCodeProvider talks to the user's local `claude` CLI, which reuses
 *    the OAuth / subscription token stored under ~/.claude/. This lets a
 *    Claude.ai *subscriber* run the translator on their machine without ever
 *    issuing a separate API key — the same auth their Claude Code session is
 *    using is good enough.
 *
 * Verified properties of `claude -p` (parent agent's M1.4 spike, 2026-05-19):
 *  - Auth: no ANTHROPIC_API_KEY required; reuses OAuth from ~/.claude/.
 *    IMPORTANT — DO NOT add `--bare`. That flag forces api-key-only auth and
 *    would defeat the whole point of this provider.
 *  - Output: with `--output-format json` the CLI emits a single JSON object
 *    `{ "type": "result", "subtype": "success", "is_error": false, "result":
 *    "<LLM text>", ... }` (errors set `type==="error"` or `is_error===true`).
 *  - Structured output: `--json-schema <schema>` is natively supported and
 *    forces the LLM to obey the schema; we use it to keep `.result` parseable
 *    without defensive markdown-fence stripping.
 *  - Cold-start: ~4s spawn overhead. Each translate call is therefore ~7-12s.
 *
 * Implementation notes:
 *  - We do NOT spawn `claude` in production-default constructors that are
 *    only later asked to .translate() — the CLI is invoked once per
 *    .translate() call, fully isolated. State is in `~/.claude/`, not in
 *    this process.
 *  - `spawnImpl` is the test seam (same pattern as OllamaProvider.fetchImpl
 *    and ClaudeProvider.withClient). Default is node:child_process.spawn.
 *  - Red line #2 (no fabrication, anti-臆造): the prompt template already
 *    encodes "evidence empty → confidence=low + placeholder label", AND the
 *    schema enforces evidence[] non-empty. We additionally short-circuit
 *    here: if a FlowGraph has zero non-empty evidence across all
 *    nodes+edges (i.e. nothing the LLM could ground on) we bypass the LLM
 *    and emit a deterministic placeholder annotation — this saves ~$0.3 of
 *    subscription quota per call AND closes a backstop hole where a flaky
 *    LLM might fabricate semantics. This mirrors MockProvider's behaviour
 *    for "nothing to translate" inputs.
 */
import { spawn as defaultSpawn, ChildProcessWithoutNullStreams } from "node:child_process";

import { BusinessAnnotations, BusinessAnnotationsSchema } from "../../schemas";
import { LLMProvider, TranslateRequest } from "../provider";
import { buildClaudePrompt } from "../prompt";
import { extractJson } from "./claude";

/** Minimal subset of `node:child_process.spawn` we depend on. */
export type SpawnImpl = (
  command: string,
  args: readonly string[],
  options?: { stdio?: ["pipe", "pipe", "pipe"] }
) => ChildProcessWithoutNullStreams;

interface ClaudeCodeOpts {
  /** Path / name of the claude CLI. Default: "claude" (must be on PATH). */
  claudeBin?: string;
  /**
   * Per-call timeout in ms. We kill the child on timeout. Default 90_000
   * (Claude can take ~12s warm; allow plenty of headroom for retries).
   */
  timeoutMs?: number;
  /**
   * Whether to pass `--json-schema <schema>`. Default true. Disable only if
   * the local CLI is too old to support the flag — but our spike confirmed
   * 2.1.144 supports it.
   */
  useJsonSchema?: boolean;
  /**
   * Optional override of the BUSINESS_ANNOTATION_SCHEMA shipped with this
   * provider. Caller can pass a stricter / looser variant. Use sparingly.
   */
  jsonSchemaOverride?: unknown;
  /**
   * Test seam: inject a custom spawn (returns a fake ChildProcess). Default
   * is node:child_process.spawn.
   */
  spawnImpl?: SpawnImpl;
}

/**
 * Minimal JSON Schema describing BusinessAnnotations 0.1.0 — passed to the
 * CLI via `--json-schema` to lock the model output into a parseable shape.
 *
 * Why hand-rolled (not generated from zod via zod-to-json-schema):
 *   - Keeps the CLI dep tree small (no new packages).
 *   - Claude Code's `--json-schema` validator is more forgiving than full
 *     JSON Schema draft-2020 — covering required keys + types here gives us
 *     90% of the value with zero deps.
 *   - The downstream BusinessAnnotationsSchema.parse() (zod) still runs as a
 *     SECOND defence; if the LLM bends the structured-output rules the zod
 *     parse will reject and we'll surface a clean error.
 */
export const BUSINESS_ANNOTATION_SCHEMA = {
  type: "object",
  required: [
    "schemaVersion",
    "entryId",
    "narrative",
    "narrativeConfidence",
    "nodeAnnotations",
    "edgeAnnotations",
  ],
  properties: {
    schemaVersion: { type: "string", const: "0.1.0" },
    entryId: { type: "string" },
    narrative: { type: "string" },
    narrativeConfidence: { type: "string", enum: ["high", "medium", "low"] },
    narrativeEvidence: {
      type: "array",
      items: { type: "string" },
    },
    nodeAnnotations: {
      type: "array",
      items: {
        type: "object",
        required: ["nodeId", "businessLabel", "confidence", "evidence"],
        properties: {
          nodeId: { type: "string" },
          businessLabel: { type: "string" },
          businessDescription: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          evidence: {
            type: "array",
            minItems: 1,
            items: { type: "string" },
          },
        },
      },
    },
    edgeAnnotations: {
      type: "array",
      items: {
        type: "object",
        required: ["edgeId", "businessLabel", "confidence", "evidence"],
        properties: {
          edgeId: { type: "string" },
          businessLabel: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          evidence: {
            type: "array",
            minItems: 1,
            items: { type: "string" },
          },
        },
      },
    },
  },
} as const;

interface ClaudeCliEnvelope {
  type: string;
  subtype?: string;
  is_error?: boolean;
  /**
   * The model's textual output. Usually a string. When `--json-schema` is
   * supplied AND the model's output validates, Claude Code MAY parse it for
   * us and put the parsed object in `structured_output` while still
   * including the raw string here. Defensive code below accepts either.
   */
  result?: string | unknown;
  /**
   * Present (in newer Claude Code versions) when --json-schema validates.
   * Holds the already-parsed object — preferred over `result` when set.
   */
  structured_output?: unknown;
  error?: string;
  message?: string;
  duration_api_ms?: number;
  usage?: unknown;
  total_cost_usd?: number;
}

export class ClaudeCodeProvider implements LLMProvider {
  readonly id = "claude-code";

  private readonly spawnImpl: SpawnImpl;
  private readonly claudeBin: string;
  private readonly timeoutMs: number;
  private readonly useJsonSchema: boolean;
  private readonly jsonSchema: unknown;

  constructor(opts: ClaudeCodeOpts = {}) {
    this.spawnImpl =
      opts.spawnImpl ?? (defaultSpawn as unknown as SpawnImpl);
    this.claudeBin = opts.claudeBin ?? "claude";
    this.timeoutMs = opts.timeoutMs ?? 90_000;
    this.useJsonSchema = opts.useJsonSchema ?? true;
    this.jsonSchema = opts.jsonSchemaOverride ?? BUSINESS_ANNOTATION_SCHEMA;
  }

  async translate(req: TranslateRequest): Promise<BusinessAnnotations> {
    // Red line #2 short-circuit: if there's literally no evidence in the
    // entire FlowGraph, the LLM has nothing to ground on. Skip the call,
    // emit a deterministic placeholder, save the API call.
    if (!hasAnyEvidence(req)) {
      return buildPlaceholderAnnotations(req);
    }

    const { system, user } = buildClaudePrompt(req);
    // `--tools ""` is LOAD-BEARING: without it, Claude Code defaults to the
    // agentic loop (it would happily try Edit/Bash to "fulfil" the prompt
    // and then summarise — producing prose like "已按 schema 输出。要点:...")
    // rather than emitting raw text. Empty tools forces single-turn,
    // text-only completion which is what we want for translation.
    const args: string[] = [
      "-p",
      "--output-format",
      "json",
      "--no-session-persistence",
      "--tools",
      "",
      "--system-prompt",
      system,
    ];
    if (this.useJsonSchema) {
      args.push("--json-schema", JSON.stringify(this.jsonSchema));
    }

    let raw: string;
    try {
      raw = await this.runCli(args, user);
    } catch (err) {
      // Normalise common spawn failures to friendlier messages.
      const msg = (err as Error).message ?? String(err);
      if (/ENOENT/.test(msg)) {
        throw new Error(
          `ClaudeCodeProvider: \`${this.claudeBin}\` CLI not found on PATH. ` +
            `Install Claude Code (https://docs.anthropic.com/en/docs/claude-code) ` +
            `and ensure it's on PATH, or use ClaudeProvider (API key) instead. ` +
            `Underlying: ${msg}`
        );
      }
      throw err;
    }

    let envelope: ClaudeCliEnvelope;
    try {
      envelope = JSON.parse(raw) as ClaudeCliEnvelope;
    } catch (err) {
      throw new Error(
        `ClaudeCodeProvider: \`${this.claudeBin}\` returned non-JSON output. ` +
          `First 200 chars: ${raw.slice(0, 200)}. ` +
          `Underlying parse error: ${(err as Error).message}`
      );
    }

    if (envelope.is_error || envelope.type === "error") {
      const detail =
        envelope.error ?? envelope.message ?? envelope.result ?? "(no detail)";
      throw new Error(
        `ClaudeCodeProvider: CLI reported error (type=${envelope.type}, ` +
          `subtype=${envelope.subtype ?? "?"}): ${detail}`
      );
    }

    // Preferred path: newer Claude Code versions parse the schema-validated
    // output for us and put the resulting object in `structured_output`.
    // Fall back to parsing `result` ourselves for older versions.
    let parsed: unknown;
    if (envelope.structured_output !== undefined && envelope.structured_output !== null) {
      parsed = envelope.structured_output;
    } else if (typeof envelope.result === "object" && envelope.result !== null) {
      // Some versions may pre-parse into .result directly. Accept.
      parsed = envelope.result;
    } else if (typeof envelope.result === "string" && envelope.result.length > 0) {
      // Legacy / plain text path — strip markdown fences then JSON.parse.
      const inner = extractJson(envelope.result);
      try {
        parsed = JSON.parse(inner);
      } catch (err) {
        const debugSnippet = envelope.result.slice(0, 600);
        throw new Error(
          `ClaudeCodeProvider: model returned non-JSON inside .result. ` +
            `First 600 chars: ${debugSnippet}\n... ` +
            `Underlying parse error: ${(err as Error).message}. ` +
            `Hint: the model may be in agent mode — ensure --tools "" is set, ` +
            `or check --json-schema enforcement.`
        );
      }
    } else {
      throw new Error(
        `ClaudeCodeProvider: CLI envelope missing both .structured_output and .result. ` +
          `Got keys: ${Object.keys(envelope).join(",")}`
      );
    }

    // Second-layer schema enforcement (red line #2 — evidence non-empty).
    return BusinessAnnotationsSchema.parse(parsed);
  }

  /**
   * Spawn the CLI, write user prompt to stdin, collect stdout, enforce
   * timeout. Returns the raw stdout string on success; throws on
   * spawn/error/timeout/exit-nonzero.
   */
  private runCli(args: readonly string[], stdinPayload: string): Promise<string> {
    return new Promise<string>((resolvePromise, rejectPromise) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = this.spawnImpl(this.claudeBin, args, {
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (err) {
        rejectPromise(err);
        return;
      }

      let stdout = "";
      let stderr = "";
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
        settle(() =>
          rejectPromise(
            new Error(
              `ClaudeCodeProvider: timed out after ${this.timeoutMs}ms ` +
                `waiting for \`${this.claudeBin}\` to respond.`
            )
          )
        );
      }, this.timeoutMs);

      child.stdout.on("data", (chunk: Buffer | string) => {
        stdout += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      });

      child.on("error", (err) => {
        settle(() => rejectPromise(err));
      });

      child.on("close", (code: number | null) => {
        if (code !== 0 && code !== null) {
          settle(() =>
            rejectPromise(
              new Error(
                `ClaudeCodeProvider: \`${this.claudeBin}\` exited with code ${code}. ` +
                  `stderr: ${stderr.slice(0, 400)}`
              )
            )
          );
          return;
        }
        // Exit 0 with stderr text is allowed (Claude Code occasionally
        // writes diagnostic warnings). We swallow it — the JSON envelope is
        // what matters.
        settle(() => resolvePromise(stdout));
      });

      // Stream user prompt then close stdin.
      try {
        child.stdin.write(stdinPayload);
        child.stdin.end();
      } catch (err) {
        settle(() => rejectPromise(err as Error));
      }
    });
  }
}

/**
 * Returns true if at least one node or edge has a non-empty evidence list.
 * When false, calling the LLM cannot do anything but fabricate — short-
 * circuit to a deterministic placeholder.
 */
function hasAnyEvidence(req: TranslateRequest): boolean {
  for (const arr of Object.values(req.evidenceByNode)) {
    if (arr.length > 0) return true;
  }
  for (const arr of Object.values(req.evidenceByEdge)) {
    if (arr.length > 0) return true;
  }
  return false;
}

/**
 * Build a deterministic, schema-valid BusinessAnnotations where every node
 * and edge is marked confidence=low with a "占位:" label. Used when the
 * FlowGraph has zero evidence so the LLM cannot ground on anything.
 */
function buildPlaceholderAnnotations(req: TranslateRequest): BusinessAnnotations {
  const { flow } = req;
  const PLACEHOLDER_EV = "(no evidence — placeholder, claude-code provider)";
  return BusinessAnnotationsSchema.parse({
    schemaVersion: "0.1.0",
    entryId: flow.entryId,
    narrative: `占位:入口 ${flow.entryId} 无足够 evidence,翻译被跳过(红线 #2)。`,
    narrativeConfidence: "low",
    narrativeEvidence: [PLACEHOLDER_EV],
    nodeAnnotations: flow.nodes.map((n) => ({
      nodeId: n.id,
      businessLabel: `占位:${n.label}`,
      confidence: "low",
      evidence: [PLACEHOLDER_EV],
    })),
    edgeAnnotations: flow.edges.map((e) => ({
      edgeId: e.id,
      businessLabel: `占位:${e.kind}`,
      confidence: "low",
      evidence: [PLACEHOLDER_EV],
    })),
  });
}

/** Test-only helpers (re-exported for the unit test). */
export const _internals = {
  hasAnyEvidence,
  buildPlaceholderAnnotations,
};
