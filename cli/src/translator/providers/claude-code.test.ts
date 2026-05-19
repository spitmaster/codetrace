/**
 * ClaudeCodeProvider — unit tests with an injected fake spawn.
 *
 * We never actually invoke the local `claude` CLI in tests — every test
 * passes a custom `spawnImpl` that returns a hand-rolled fake ChildProcess
 * mimicking the envelope shape the real CLI emits (verified in M1.4 spike).
 * This keeps the test suite hermetic, fast, and free of subscription cost.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { FlowGraphSchema } from "../../schemas";
import { ClaudeCodeProvider, SpawnImpl } from "./claude-code";

const ROOT = resolve(__dirname, "../../../../fixtures/fixture-a-order-app/ground-truth");

function loadFlow(slug: string) {
  const text = readFileSync(
    resolve(ROOT, `flow-graph-${slug}.expected.json`),
    "utf8"
  );
  return FlowGraphSchema.parse(JSON.parse(text));
}

/**
 * Build a fake ChildProcess (only the bits ClaudeCodeProvider uses):
 *  - stdout / stderr / stdin
 *  - on("error" | "close")
 *
 * Behaviour is parametrised:
 *   - mode "ok" → after stdin closes, write `stdoutEnvelope` to stdout and
 *     emit close(0).
 *   - mode "spawnError" → immediately emit error event (e.g. ENOENT).
 *   - mode "exitError" → emit close(1) after writing optional stderr.
 *
 * Captures `args` and `stdinPayload` so the test can assert on prompt shape.
 */
function makeFakeSpawn(opts: {
  mode: "ok" | "spawnError" | "exitError";
  stdoutEnvelope?: unknown;
  stdoutRaw?: string; // override envelope with raw text (for "not JSON" tests)
  stderr?: string;
  exitCode?: number;
  errorEvent?: Error;
  /** Captured by reference — caller can inspect after translate() runs. */
  captured: { args?: readonly string[]; stdin?: string };
}): SpawnImpl {
  return (_cmd, args) => {
    const child = new EventEmitter() as unknown as {
      stdout: PassThrough;
      stderr: PassThrough;
      stdin: PassThrough;
      kill(sig: string): boolean;
      on: EventEmitter["on"];
      emit: EventEmitter["emit"];
    };
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdin = new PassThrough();
    (child as unknown as { stdout: PassThrough }).stdout = stdout;
    (child as unknown as { stderr: PassThrough }).stderr = stderr;
    (child as unknown as { stdin: PassThrough }).stdin = stdin;
    (child as unknown as { kill: (sig: string) => boolean }).kill = () => true;

    opts.captured.args = args;
    let stdinBuf = "";
    stdin.on("data", (chunk) => {
      stdinBuf += chunk.toString("utf8");
    });
    stdin.on("end", () => {
      opts.captured.stdin = stdinBuf;
      // After stdin closes we deliver the fake response asynchronously.
      setImmediate(() => {
        if (opts.mode === "spawnError") {
          (child as unknown as EventEmitter).emit(
            "error",
            opts.errorEvent ?? new Error("spawn ENOENT")
          );
          return;
        }
        if (opts.stderr) stderr.write(opts.stderr);
        if (opts.stdoutRaw !== undefined) {
          stdout.write(opts.stdoutRaw);
        } else if (opts.stdoutEnvelope !== undefined) {
          stdout.write(JSON.stringify(opts.stdoutEnvelope));
        }
        stdout.end();
        stderr.end();
        const code = opts.mode === "exitError" ? opts.exitCode ?? 1 : 0;
        (child as unknown as EventEmitter).emit("close", code);
      });
    });

    // If the test wants spawn to fail immediately (before stdin even sees
    // data), schedule the error event ahead of stdin.end()'s setImmediate.
    if (opts.mode === "spawnError" && !opts.errorEvent) {
      // do nothing here; we'll emit after stdin.end so stdin write/end
      // doesn't throw on a destroyed stream. Tests that need ENOENT-on-
      // spawn use the spawn function itself throwing — see spawnThrows below.
    }

    return child as unknown as ReturnType<SpawnImpl>;
  };
}

function makeAnnotation(flow: ReturnType<typeof loadFlow>) {
  return {
    schemaVersion: "0.1.0" as const,
    entryId: flow.entryId,
    narrative: "x",
    narrativeConfidence: "high" as const,
    narrativeEvidence: ["e"],
    nodeAnnotations: flow.nodes.map((n) => ({
      nodeId: n.id,
      businessLabel: "L",
      confidence: "high" as const,
      evidence: ["e"],
    })),
    edgeAnnotations: flow.edges.map((e) => ({
      edgeId: e.id,
      businessLabel: "L",
      confidence: "high" as const,
      evidence: ["e"],
    })),
  };
}

function happyEnvelope(flow: ReturnType<typeof loadFlow>) {
  const fakeAnnotation = {
    schemaVersion: "0.1.0",
    entryId: flow.entryId,
    narrative: "用户下单。系统鉴权、校验库存、创建订单、返回。",
    narrativeConfidence: "high",
    narrativeEvidence: ["faked-evidence"],
    nodeAnnotations: flow.nodes.map((n) => ({
      nodeId: n.id,
      businessLabel: `测:${n.label}`.slice(0, 12),
      confidence: "high",
      evidence: ["faked-evidence"],
    })),
    edgeAnnotations: flow.edges.map((e) => ({
      edgeId: e.id,
      businessLabel: `测:${e.kind}`,
      confidence: "high",
      evidence: ["faked-evidence"],
    })),
  };
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    result: JSON.stringify(fakeAnnotation),
    duration_api_ms: 7416,
    total_cost_usd: 0.31,
  };
}

describe("ClaudeCodeProvider", () => {
  it("id is 'claude-code'", () => {
    expect(new ClaudeCodeProvider().id).toBe("claude-code");
  });

  it("happy path — envelope.result holds JSON; double-decoded into BusinessAnnotations", async () => {
    const flow = loadFlow("POST_api_orders");
    const captured: { args?: readonly string[]; stdin?: string } = {};
    const provider = new ClaudeCodeProvider({
      spawnImpl: makeFakeSpawn({
        mode: "ok",
        stdoutEnvelope: happyEnvelope(flow),
        captured,
      }),
    });
    const out = await provider.translate({
      flow,
      evidenceByNode: Object.fromEntries(flow.nodes.map((n) => [n.id, ["e"]])),
      evidenceByEdge: Object.fromEntries(flow.edges.map((e) => [e.id, ["e"]])),
    });
    expect(out.entryId).toBe(flow.entryId);
    expect(out.nodeAnnotations.length).toBe(flow.nodes.length);
    expect(out.edgeAnnotations.length).toBe(flow.edges.length);
    // Args sanity: must include -p, --output-format json, --system-prompt,
    // --json-schema, --no-session-persistence. Must NOT include --bare.
    expect(captured.args).toContain("-p");
    expect(captured.args).toContain("--output-format");
    expect(captured.args).toContain("json");
    expect(captured.args).toContain("--system-prompt");
    expect(captured.args).toContain("--json-schema");
    expect(captured.args).toContain("--no-session-persistence");
    // `--tools ""` is load-bearing — disables agent tool loop so the model
    // emits pure text instead of summarising "已按 schema 输出。要点:".
    expect(captured.args).toContain("--tools");
    // Empty-string value follows the --tools flag.
    const idx = (captured.args as string[]).indexOf("--tools");
    expect((captured.args as string[])[idx + 1]).toBe("");
    expect(captured.args).not.toContain("--bare");
    // Stdin carries the user prompt with FlowGraph JSON inside.
    expect(captured.stdin).toContain(flow.entryId);
  });

  it("red line #2 — flow with zero evidence short-circuits, never spawns CLI", async () => {
    const flow = loadFlow("POST_api_orders");
    let spawned = false;
    const provider = new ClaudeCodeProvider({
      spawnImpl: (() => {
        spawned = true;
        // Return a fake that would throw if anyone tried to use it; we
        // never expect to get here.
        return makeFakeSpawn({
          mode: "ok",
          stdoutEnvelope: happyEnvelope(flow),
          captured: {},
        })("claude", []);
      }) as unknown as SpawnImpl,
    });
    const out = await provider.translate({
      flow,
      evidenceByNode: Object.fromEntries(flow.nodes.map((n) => [n.id, []])),
      evidenceByEdge: Object.fromEntries(flow.edges.map((e) => [e.id, []])),
    });
    expect(spawned).toBe(false);
    // Every annotation must be low + 占位 prefix.
    for (const a of out.nodeAnnotations) {
      expect(a.confidence).toBe("low");
      expect(a.businessLabel.startsWith("占位:")).toBe(true);
    }
    for (const a of out.edgeAnnotations) {
      expect(a.confidence).toBe("low");
      expect(a.businessLabel.startsWith("占位:")).toBe(true);
    }
    expect(out.narrativeConfidence).toBe("low");
  });

  it("error envelope (is_error=true) is surfaced as a thrown error", async () => {
    const flow = loadFlow("GET_api_orders");
    const captured: { args?: readonly string[]; stdin?: string } = {};
    const provider = new ClaudeCodeProvider({
      spawnImpl: makeFakeSpawn({
        mode: "ok",
        stdoutEnvelope: {
          type: "error",
          is_error: true,
          error: "rate_limited",
        },
        captured,
      }),
    });
    await expect(
      provider.translate({
        flow,
        evidenceByNode: Object.fromEntries(flow.nodes.map((n) => [n.id, ["e"]])),
        evidenceByEdge: Object.fromEntries(flow.edges.map((e) => [e.id, ["e"]])),
      })
    ).rejects.toThrow(/rate_limited|CLI reported error/);
  });

  it("non-JSON stdout is surfaced with a clear error including a snippet", async () => {
    const flow = loadFlow("GET_api_orders");
    const captured: { args?: readonly string[]; stdin?: string } = {};
    const provider = new ClaudeCodeProvider({
      spawnImpl: makeFakeSpawn({
        mode: "ok",
        stdoutRaw: "Error: command not configured properly",
        captured,
      }),
    });
    await expect(
      provider.translate({
        flow,
        evidenceByNode: Object.fromEntries(flow.nodes.map((n) => [n.id, ["e"]])),
        evidenceByEdge: Object.fromEntries(flow.edges.map((e) => [e.id, ["e"]])),
      })
    ).rejects.toThrow(/non-JSON output/);
  });

  it("spawn ENOENT (claude not on PATH) is normalised to a friendly error", async () => {
    const flow = loadFlow("GET_api_orders");
    const spawnThrows: SpawnImpl = () => {
      const err = new Error("spawn claude ENOENT") as Error & { code?: string };
      err.code = "ENOENT";
      throw err;
    };
    const provider = new ClaudeCodeProvider({ spawnImpl: spawnThrows });
    await expect(
      provider.translate({
        flow,
        evidenceByNode: Object.fromEntries(flow.nodes.map((n) => [n.id, ["e"]])),
        evidenceByEdge: Object.fromEntries(flow.edges.map((e) => [e.id, ["e"]])),
      })
    ).rejects.toThrow(/CLI not found on PATH/);
  });

  it("double-decode — envelope.result is a JSON string (legacy CLI path)", async () => {
    // This is the load-bearing shape contract from the spike. Older Claude
    // Code versions return .result as a string; newer versions populate
    // .structured_output with the pre-parsed object (covered in the next
    // test). Both must work.
    const flow = loadFlow("GET_api_orders");
    const fakeAnnotation = makeAnnotation(flow);
    const captured: { args?: readonly string[]; stdin?: string } = {};
    const provider = new ClaudeCodeProvider({
      spawnImpl: makeFakeSpawn({
        mode: "ok",
        stdoutEnvelope: {
          type: "result",
          is_error: false,
          // Stringified — legacy contract.
          result: JSON.stringify(fakeAnnotation),
        },
        captured,
      }),
    });
    const out = await provider.translate({
      flow,
      evidenceByNode: Object.fromEntries(flow.nodes.map((n) => [n.id, ["e"]])),
      evidenceByEdge: Object.fromEntries(flow.edges.map((e) => [e.id, ["e"]])),
    });
    expect(out.entryId).toBe(flow.entryId);
    expect(out.narrative).toBe("x");
  });

  it("envelope.structured_output (newer CLI) is preferred over .result", async () => {
    // Newer Claude Code (>= 2.1.144 in our spike) emits both: .result as a
    // stringified copy AND .structured_output as the already-parsed object.
    // We prefer .structured_output because it skips a redundant JSON.parse
    // and avoids fragility around what the LLM put around the JSON.
    const flow = loadFlow("GET_api_orders");
    const fakeAnnotation = makeAnnotation(flow);
    const captured: { args?: readonly string[]; stdin?: string } = {};
    const provider = new ClaudeCodeProvider({
      spawnImpl: makeFakeSpawn({
        mode: "ok",
        stdoutEnvelope: {
          type: "result",
          is_error: false,
          // Even if .result is intentionally garbage, .structured_output wins.
          result: "this would fail to parse but we shouldn't try",
          structured_output: fakeAnnotation,
        },
        captured,
      }),
    });
    const out = await provider.translate({
      flow,
      evidenceByNode: Object.fromEntries(flow.nodes.map((n) => [n.id, ["e"]])),
      evidenceByEdge: Object.fromEntries(flow.edges.map((e) => [e.id, ["e"]])),
    });
    expect(out.entryId).toBe(flow.entryId);
    expect(out.narrative).toBe("x");
  });
});
