import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { mapEntries } from "../index";

const FIXTURE_ROOT = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "fixtures",
  "fixture-a-order-app",
  "backend"
);
const GROUND_TRUTH_PATH = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "fixtures",
  "fixture-a-order-app",
  "ground-truth",
  "io-entry-registry.expected.json"
);

interface ExpectedEntry {
  id: string;
  kind: string;
  displayName: string;
  handlerSymbolId: string;
  middlewareSymbolIds?: string[];
}

interface ExpectedRegistry {
  schemaVersion: string;
  entries: ExpectedEntry[];
}

const expected = JSON.parse(readFileSync(GROUND_TRUTH_PATH, "utf8")) as ExpectedRegistry;

describe("mapEntries(fixture-a backend)", () => {
  const actual = mapEntries({ projectRoot: FIXTURE_ROOT });

  it("emits a schema-versioned IOEntryRegistry", () => {
    expect(actual.schemaVersion).toBe("0.1.0");
  });

  it("finds all 5 IO entries (no fewer, no more) — accuracy 100% per SPEC §7", () => {
    expect(actual.entries.length).toBe(expected.entries.length);
    const actualIds = new Set(actual.entries.map((e) => e.id));
    const expectedIds = new Set(expected.entries.map((e) => e.id));
    expect(actualIds).toEqual(expectedIds);
  });

  it("each entry's id, displayName, handlerSymbolId match ground-truth exactly", () => {
    for (const exp of expected.entries) {
      const got = actual.entries.find((e) => e.id === exp.id);
      expect(got, `missing entry: ${exp.id}`).toBeDefined();
      expect(got!.kind).toBe(exp.kind);
      expect(got!.displayName).toBe(exp.displayName);
      expect(got!.handlerSymbolId).toBe(exp.handlerSymbolId);
    }
  });

  it("middlewareSymbolIds match ground-truth for protected endpoints", () => {
    for (const exp of expected.entries) {
      const got = actual.entries.find((e) => e.id === exp.id);
      expect(got, `missing entry: ${exp.id}`).toBeDefined();
      const expMw = exp.middlewareSymbolIds ?? [];
      const gotMw = got!.middlewareSymbolIds ?? [];
      expect(gotMw.sort()).toEqual(expMw.sort());
    }
  });

  it("every entry has confidence=high (deterministic recovery from source)", () => {
    for (const e of actual.entries) {
      expect(e.confidence).toBe("high");
    }
  });
});
