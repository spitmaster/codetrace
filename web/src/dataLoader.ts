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

export function entryToSlug(entry: IOEntry): string {
  // io:http:POST:/api/orders → POST_api_orders
  const method = entry.method ?? "ANY";
  const path = (entry.path ?? "/").replace(/^\//, "").replace(/[\/:]/g, "_");
  return `${method}_${path}`;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`fetch ${path}: HTTP ${res.status}`);
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
