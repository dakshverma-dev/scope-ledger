import { z } from "zod";
import { isLiteralQuote } from "@/lib/domain/evidence";
import { classificationSchema } from "@/lib/domain/validation";

export const TOOL_NAME = "extract_scope_changes";

export const AI_LIMITS = { items: 10, missing: 10, change: 300, quote: 1000, reason: 500, question: 300 } as const;

/** Exact tool-output contract. Strict: unknown fields are rejected, not stripped. */
export const extractionSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        requestedChange: z.string().trim().min(1).max(AI_LIMITS.change),
        sourceQuote: z.string().min(1).max(AI_LIMITS.quote),
        baselineItemIds: z.array(z.string().min(1).max(20)).max(10),
        classification: classificationSchema,
        reason: z.string().trim().min(1).max(AI_LIMITS.reason),
      }),
    )
    .max(AI_LIMITS.items),
  missingInformation: z.array(z.string().trim().min(1).max(AI_LIMITS.question)).max(AI_LIMITS.missing),
});
export type Extraction = z.infer<typeof extractionSchema>;
export type ExtractedItem = Extraction["items"][number];

/** JSON Schema sent as the tool input_schema (strict tool use). Size limits are enforced by Zod, not here. */
export const toolInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["items", "missingInformation"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["requestedChange", "sourceQuote", "baselineItemIds", "classification", "reason"],
        properties: {
          requestedChange: { type: "string", description: "The concrete change the client asks for, in plain words." },
          sourceQuote: { type: "string", description: "An exact, verbatim substring of the client request supporting this item." },
          baselineItemIds: {
            type: "array",
            items: { type: "string" },
            description: "IDs of the supplied baseline items this change relates to. Only IDs that exist.",
          },
          classification: { type: "string", enum: ["potential_addition", "clarification", "unclear"] },
          reason: { type: "string", description: "Brief explanation grounded only in the supplied texts." },
        },
      },
    },
    missingInformation: {
      type: "array",
      items: { type: "string" },
      description: "Questions or unknown facts the consultant should resolve.",
    },
  },
} as const;

export type ValidationResult = { ok: true; value: Extraction } | { ok: false; errors: string[] };

/**
 * Server post-validation, no exceptions: shape (Zod), baseline ID membership and
 * literal quotes (whitespace-only normalisation). Nothing is repaired silently.
 */
export function validateExtraction(raw: unknown, baselineIds: readonly string[], requestText: string): ValidationResult {
  const parsed = extractionSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }
  const known = new Set(baselineIds);
  const errors: string[] = [];
  parsed.data.items.forEach((item, idx) => {
    for (const id of item.baselineItemIds) {
      if (!known.has(id)) errors.push(`items.${idx}.baselineItemIds: "${id.slice(0, 20)}" is not a baseline ID; use only ${[...known].join(", ")}`);
    }
    if (!isLiteralQuote(requestText, item.sourceQuote)) {
      errors.push(`items.${idx}.sourceQuote is not an exact substring of the client request`);
    }
  });
  return errors.length ? { ok: false, errors } : { ok: true, value: parsed.data };
}
