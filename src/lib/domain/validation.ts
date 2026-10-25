import { z } from "zod";

export const LIMITS = {
  nameMax: 100,
  baselineItemsMax: 10,
  baselineTextMax: 500,
  originalFeeMaxPence: 100_000_000,
  rateMaxPence: 100_000,
  requestMax: 5000,
  approvedItemsMax: 10,
  effortMin: 15,
  effortMax: 2400,
  effortStep: 15,
  declaredNameMax: 100,
  noteMax: 1000,
} as const;

const nonBlank = (max: number) =>
  z
    .string()
    .max(max)
    .refine((s) => s.trim().length > 0, { message: "Required" });

/** A real calendar date in YYYY-MM-DD form. */
export const isoDateSchema = z.iso.date().refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, "Invalid date");

export const baselineIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$/, "Invalid baseline ID");

export const baselineItemSchema = z.strictObject({
  id: baselineIdSchema,
  text: nonBlank(LIMITS.baselineTextMax),
});

export const baselineItemsSchema = z
  .array(baselineItemSchema)
  .min(1)
  .max(LIMITS.baselineItemsMax)
  .refine((items) => new Set(items.map((i) => i.id)).size === items.length, "Baseline IDs must be unique");

export const createProjectSchema = z.strictObject({
  name: nonBlank(LIMITS.nameMax),
  clientName: nonBlank(LIMITS.nameMax),
  baselineItems: baselineItemsSchema,
  originalFeePence: z.int().min(0).max(LIMITS.originalFeeMaxPence),
  ratePence: z.int().min(1).max(LIMITS.rateMaxPence),
  dueOn: isoDateSchema,
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const classificationSchema = z.enum(["potential_addition", "clarification", "unclear"]);
export type Classification = z.infer<typeof classificationSchema>;

export const approvedItemSchema = z
  .strictObject({
    id: z.string().min(1).max(40),
    description: nonBlank(500),
    baselineItemIds: z.array(baselineIdSchema).max(LIMITS.baselineItemsMax),
    origin: z.enum(["ai_suggested", "manually_entered"]),
    sourceQuote: z.string().max(LIMITS.requestMax).nullable(),
    classification: classificationSchema.nullable(),
  })
  .refine((i) => i.origin === "ai_suggested" || i.sourceQuote === null, {
    message: "Manually entered items carry no model quote",
    path: ["sourceQuote"],
  });
export type ApprovedItem = z.infer<typeof approvedItemSchema>;

export const requestTextSchema = nonBlank(LIMITS.requestMax);

export const effortMinutesSchema = z
  .int()
  .min(LIMITS.effortMin)
  .max(LIMITS.effortMax)
  .refine((m) => m % LIMITS.effortStep === 0, "Effort must be in 15-minute increments");

/**
 * Publish payload. Strict: any extra key (e.g. an injected fee) is a 422.
 * Money is never part of this contract.
 */
export const publishSchema = z
  .strictObject({
    publishKey: z.uuid(),
    expectedCurrentVersionId: z.uuid().nullable(),
    requestText: requestTextSchema,
    approvedItems: z.array(approvedItemSchema).min(1).max(LIMITS.approvedItemsMax),
    effortMinutes: effortMinutesSchema,
    revisedDueOn: isoDateSchema,
    confirmed: z.literal(true),
  })
  .refine((p) => new Set(p.approvedItems.map((i) => i.id)).size === p.approvedItems.length, {
    message: "Item IDs must be unique",
    path: ["approvedItems"],
  });
export type PublishInput = z.infer<typeof publishSchema>;

export const analyseSchema = z.strictObject({ requestText: requestTextSchema });

export const decisionValueSchema = z.enum(["accepted", "revision_requested"]);
export type DecisionValue = z.infer<typeof decisionValueSchema>;

export const decisionSchema = z.strictObject({
  decision: decisionValueSchema,
  declaredName: nonBlank(LIMITS.declaredNameMax).transform((s) => s.trim()),
  note: z
    .string()
    .max(LIMITS.noteMax)
    .nullish()
    .transform((s) => (s && s.trim() ? s.trim() : null)),
});
export type DecisionInput = z.infer<typeof decisionSchema>;

/** 32 random bytes, base64url without padding. */
export const reviewTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const uuidSchema = z.uuid();

/** Turns Zod issues into a short, safe message. */
export function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
    .join("; ");
}
