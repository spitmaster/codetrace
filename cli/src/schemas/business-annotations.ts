import { z } from "zod";
import { Confidence, SchemaVersion } from "./common";

// BusinessAnnotations — business-translator output (one per IO entry).
// Reference: docs/agents/codeviz-overview.md §BusinessAnnotations
//
// Red line #2 (anti-fabrication): every annotation MUST carry non-empty
// evidence. The schema enforces evidence.length >= 1.

const NodeAnnotation = z
  .object({
    nodeId: z.string().min(1),
    businessLabel: z.string().min(1),
    businessDescription: z.string().optional(),
    confidence: Confidence,
    evidence: z.array(z.string().min(1)).min(1, {
      message: "evidence must contain at least one entry (red line #2 — no fabrication)",
    }),
  })
  .passthrough();

const EdgeAnnotation = z
  .object({
    edgeId: z.string().min(1),
    businessLabel: z.string().min(1),
    confidence: Confidence,
    evidence: z.array(z.string().min(1)).min(1, {
      message: "evidence must contain at least one entry (red line #2 — no fabrication)",
    }),
  })
  .passthrough();

export const BusinessAnnotationsSchema = z
  .object({
    schemaVersion: SchemaVersion,
    entryId: z.string().min(1),
    narrative: z.string().min(1),
    narrativeConfidence: Confidence,
    narrativeEvidence: z.array(z.string().min(1)).optional(),
    nodeAnnotations: z.array(NodeAnnotation),
    edgeAnnotations: z.array(EdgeAnnotation),
  })
  .passthrough();

export type BusinessAnnotations = z.infer<typeof BusinessAnnotationsSchema>;
