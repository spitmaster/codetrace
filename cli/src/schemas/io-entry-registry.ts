import { z } from "zod";
import { Confidence, SchemaVersion, SymbolId } from "./common";

// IOEntryRegistry — io-entry-mapper output.
// Reference: docs/agents/codeviz-overview.md §IOEntryRegistry

const EntryKind = z.enum([
  "http",
  "frontend-event",
  "cli",
  "queue",
  "cron",
  "websocket",
]);

const Entry = z
  .object({
    id: z.string().min(1),
    kind: EntryKind,
    displayName: z.string().min(1),
    framework: z.string().min(1).optional(),
    handlerSymbolId: SymbolId,
    middlewareSymbolIds: z.array(SymbolId).optional(),
    metadata: z.record(z.unknown()).optional(),
    group: z.string().optional(),
    businessLabel: z.string().optional(),
    confidence: Confidence,
  })
  .passthrough();

export const IOEntryRegistrySchema = z
  .object({
    schemaVersion: SchemaVersion,
    entries: z.array(Entry),
  })
  .passthrough();

export type IOEntryRegistry = z.infer<typeof IOEntryRegistrySchema>;
