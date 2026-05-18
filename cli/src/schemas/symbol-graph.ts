import { z } from "zod";
import {
  Confidence,
  FileLocation,
  Range,
  SchemaVersion,
  SymbolId,
} from "./common";

// SymbolGraph — static-code-analyzer output.
// Reference: docs/agents/codeviz-overview.md §SymbolGraph
// All fields are required unless explicitly .optional(); .passthrough() at the
// top level so ground-truth files can carry `_comment` / `_evidenceSource`
// without breaking validation.

const Framework = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1).optional(),
    confidence: Confidence,
  })
  .passthrough();

const Symbol = z
  .object({
    id: SymbolId,
    kind: z.string().min(1), // function | method | class | variable | handler | ...
    name: z.string().min(1),
    qualifiedName: z.string().min(1),
    filePath: z.string().min(1),
    range: Range,
    signature: z.string().optional(),
    visibility: z.enum(["public", "private", "protected", "internal"]).optional(),
    decorators: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
  })
  .passthrough();

const Call = z
  .object({
    callerId: SymbolId,
    calleeId: SymbolId,
    callKind: z.enum(["direct", "virtual", "dynamic", "framework-injected"]),
    fileLocation: FileLocation,
    confidence: Confidence,
  })
  .passthrough();

const FrameworkPoint = z
  .object({
    kind: z.enum(["decorator", "annotation", "convention"]),
    framework: z.string().min(1),
    symbolId: SymbolId,
    meaning: z.string().min(1),
    raw: z.string().min(1),
  })
  .passthrough();

const DataAccessPoint = z
  .object({
    kind: z.enum(["orm-call", "raw-sql", "file-io", "http-call", "queue-publish"]),
    symbolId: SymbolId,
    target: z.string().min(1),
    operation: z.enum(["read", "write", "delete"]),
    fileLocation: FileLocation,
    raw: z.string().optional(),
    confidence: Confidence,
  })
  .passthrough();

export const SymbolGraphSchema = z
  .object({
    schemaVersion: SchemaVersion,
    rootPath: z.string().min(1),
    languages: z.array(z.string().min(1)).min(1),
    frameworks: z.array(Framework),
    symbols: z.array(Symbol),
    calls: z.array(Call),
    frameworkPoints: z.array(FrameworkPoint),
    dataAccessPoints: z.array(DataAccessPoint),
  })
  .passthrough();

export type SymbolGraph = z.infer<typeof SymbolGraphSchema>;
