import { z } from "zod";

// Schema version used by every M1 intermediate-representation JSON.
// Increment when any of the four schemas change shape; orchestrator must
// approve the bump (see codeviz-overview red line #6).
export const SCHEMA_VERSION = "0.1.0";

export const SchemaVersion = z.literal(SCHEMA_VERSION);

export const Confidence = z.enum(["high", "medium", "low"]);

export const FileLocation = z
  .object({
    file: z.string().min(1),
    line: z.number().int().positive(),
    column: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export const Range = z
  .object({
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    startColumn: z.number().int().nonnegative().optional(),
    endColumn: z.number().int().nonnegative().optional(),
  })
  .refine((r) => r.endLine >= r.startLine, {
    message: "endLine must be >= startLine",
  });

// Symbol IDs follow `<lang>:<path>#<qualifiedName>` (overview §SymbolGraph).
// We don't lock down the language tag yet — M1 is TS only, but the schema
// should be forward-compatible.
export const SymbolId = z.string().regex(/^[a-z]+:[^#]+#.+$/, {
  message: 'symbolId must match "<lang>:<path>#<qualifiedName>"',
});

export const FreeMetadata = z.record(z.unknown()).optional();
