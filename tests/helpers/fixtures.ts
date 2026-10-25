import { randomUUID } from "node:crypto";
import type { PublishInput } from "@/lib/domain/validation";

export const NORTHLIGHT_REQUEST = "Please add two service pages and a second round of revisions.";

/** The fixture's consultant-approved version 1 (90 minutes, revised due 2026-11-11). */
export const NORTHLIGHT_PUBLISH = (overrides: Partial<PublishInput> = {}): PublishInput => ({
  publishKey: randomUUID(),
  expectedCurrentVersionId: null,
  requestText: NORTHLIGHT_REQUEST,
  approvedItems: [
    {
      id: "c1",
      description: "Add two service pages",
      baselineItemIds: ["B1"],
      origin: "ai_suggested",
      sourceQuote: "add two service pages",
      classification: "potential_addition",
    },
    {
      id: "c2",
      description: "A second round of revisions",
      baselineItemIds: ["B2"],
      origin: "ai_suggested",
      sourceQuote: "a second round of revisions",
      classification: "potential_addition",
    },
  ],
  effortMinutes: 90,
  revisedDueOn: "2026-11-11",
  confirmed: true,
  ...overrides,
});
