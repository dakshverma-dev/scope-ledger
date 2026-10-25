import type { ReviewRepository } from "@/lib/db/repository";
import { hashToken } from "@/lib/domain/tokens";
import type { DecisionResult, ReviewSnapshot } from "@/lib/domain/types";
import { reviewTokenSchema, type DecisionInput } from "@/lib/domain/validation";
import { AppError } from "@/lib/http/errors";

/**
 * Malformed, unknown, revoked, expired and superseded tokens all produce the same
 * UNAVAILABLE error; nothing about the underlying record is revealed.
 */
export async function getReview(repo: ReviewRepository, token: string): Promise<ReviewSnapshot> {
  if (!reviewTokenSchema.safeParse(token).success) throw new AppError("UNAVAILABLE");
  const snapshot = await repo.getSnapshot(hashToken(token));
  if (!snapshot) throw new AppError("UNAVAILABLE");
  return snapshot;
}

/** Money and dates are never accepted from the reviewer; the routine reads them from the version. */
export async function submitDecision(repo: ReviewRepository, token: string, input: DecisionInput): Promise<DecisionResult> {
  if (!reviewTokenSchema.safeParse(token).success) throw new AppError("UNAVAILABLE");
  return repo.recordDecision({
    tokenHash: hashToken(token),
    decision: input.decision,
    declaredName: input.declaredName,
    note: input.note,
  });
}
