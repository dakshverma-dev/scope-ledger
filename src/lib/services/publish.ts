import type { OwnerRepository } from "@/lib/db/repository";
import { extraFeePence, revisedTotalPence } from "@/lib/domain/money";
import { generateReviewToken, hashToken } from "@/lib/domain/tokens";
import type { PublishResult } from "@/lib/domain/types";
import { uuidSchema, type PublishInput } from "@/lib/domain/validation";
import { AppError } from "@/lib/http/errors";

export interface PublishOutcome extends PublishResult {
  /** Plaintext bearer token: returned once, never stored or logged. */
  reviewToken: string;
}

/**
 * Validates against the owner's project, then hands the whole publication to
 * the single database transaction. Money comes only from the database result.
 */
export async function publishChange(repo: OwnerRepository, projectId: string, input: PublishInput): Promise<PublishOutcome> {
  if (!uuidSchema.safeParse(projectId).success) throw new AppError("NOT_FOUND");
  const project = await repo.getProject(projectId);
  if (!project) throw new AppError("NOT_FOUND");

  const baselineIds = new Set(project.baselineItems.map((b) => b.id));
  for (const item of input.approvedItems) {
    if (item.baselineItemIds.some((id) => !baselineIds.has(id))) {
      throw new AppError("VALIDATION_FAILED", "An approved item refers to a baseline ID that does not exist in this project.");
    }
  }
  if (input.revisedDueOn < project.dueOn) {
    throw new AppError("VALIDATION_FAILED", "The revised due date cannot be earlier than the original due date.");
  }

  const reviewToken = generateReviewToken();
  const result = await repo.publish({
    projectId: project.id,
    publishKey: input.publishKey,
    expectedCurrentVersionId: input.expectedCurrentVersionId,
    requestText: input.requestText,
    approvedItems: input.approvedItems,
    effortMinutes: input.effortMinutes,
    revisedDueOn: input.revisedDueOn,
    tokenHash: hashToken(reviewToken),
  });

  // Defence in depth: the committed fee must match the specification formula.
  if (result.created) {
    const expected = extraFeePence(project.ratePence, input.effortMinutes);
    if (result.extraFeePence !== expected || result.revisedTotalPence !== revisedTotalPence(project.originalFeePence, expected)) {
      throw new AppError("INTERNAL");
    }
  }
  return { ...result, reviewToken };
}

export function reviewUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/review/${token}`;
}
