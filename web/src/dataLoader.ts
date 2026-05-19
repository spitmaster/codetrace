/**
 * Loads the four JSON artefacts emitted by `npm run e2e:m1` into typed
 * structures the UI can consume.
 *
 * Why fetch (not bundled JSON): keeping artefacts on-disk means the
 * developer can regenerate them via `npm run e2e:m1` and refresh the page,
 * without rebundling. The exact path layout is documented in SPEC §5
 * project-structure: `reports/m1-out/*.json`.
 *
 * The mapping from IOEntry → slug is mechanical: replace `:` with `_`,
 * `/` with `_` and strip leading prefix. We compute it in one place to keep
 * the URL convention discoverable.
 */
import type {
  BusinessAnnotations,
  FlowGraph,
  IOEntry,
  IOEntryRegistry,
} from "./types";

const DATA_PREFIX = "/data";

export interface BundleForEntry {
  entry: IOEntry;
  flow: FlowGraph;
  annotations: BusinessAnnotations;
}

/**
 * Parse the canonical `io:<proto>:<method>:<path>` id format. This is the
 * source of truth — `entry.method` / `entry.path` are NOT top-level fields in
 * the schema 0.1.0 IOEntry (they live in `metadata.httpMethod` / `metadata.path`
 * and there's no contract that they're always present). The id is.
 *
 * Examples:
 *   io:http:POST:/api/orders     → { method: "POST", path: "/api/orders" }
 *   io:http:GET:/api/orders/:id  → { method: "GET",  path: "/api/orders/:id" }
 *   io:http:GET:/health          → { method: "GET",  path: "/health" }
 */
export function parseEntryId(id: string): { method: string; path: string } | null {
  const m = id.match(/^io:[^:]+:([^:]+):(.+)$/);
  if (!m) return null;
  return { method: m[1], path: m[2] };
}

export function entryToSlug(entry: IOEntry): string {
  // POST_api_orders, GET_health, GET_api_orders_id, etc.
  const parsed = parseEntryId(entry.id);
  if (!parsed) return "UNKNOWN";
  const path = parsed.path.replace(/^\//, "").replace(/[\/:]/g, "_");
  return `${parsed.method}_${path}`;
}

export class HttpStatusError extends Error {
  constructor(public readonly path: string, public readonly status: number) {
    super(`fetch ${path}: HTTP ${status}`);
    this.name = "HttpStatusError";
  }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new HttpStatusError(path, res.status);
  }
  return res.json() as Promise<T>;
}

export async function loadRegistry(): Promise<IOEntryRegistry> {
  return getJson<IOEntryRegistry>(`${DATA_PREFIX}/io-entry-registry.json`);
}

export async function loadEntryBundle(entry: IOEntry): Promise<BundleForEntry> {
  const slug = entryToSlug(entry);
  const [flow, annotations] = await Promise.all([
    getJson<FlowGraph>(`${DATA_PREFIX}/flow-graph-${slug}.json`),
    getJson<BusinessAnnotations>(`${DATA_PREFIX}/business-annotations-${slug}.json`),
  ]);
  return { entry, flow, annotations };
}
