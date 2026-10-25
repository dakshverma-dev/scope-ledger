import { extractScopeChanges, type CreateMessage, type FailureCode } from "@/lib/ai/extract";
import type { ExtractedItem } from "@/lib/ai/schema";
import type { OwnerRepository } from "@/lib/db/repository";
import { sha256Hex } from "@/lib/domain/tokens";
import { uuidSchema } from "@/lib/domain/validation";
import { AppError } from "@/lib/http/errors";

export interface AnalysisResponse {
  runId: string;
  items: ExtractedItem[];
  missingInformation: string[];
  needsJudgment: boolean;
  modelId: string;
}

const FAILURE_MESSAGE: Record<FailureCode, string> = {
  TIMEOUT: "Analysis unavailable: the model did not answer within 30 seconds.",
  MODEL_UNAVAILABLE: "Analysis unavailable: the configured model is not available to this API key.",
  UPSTREAM_ERROR: "Analysis unavailable: the model service returned an error.",
  INVALID_OUTPUT: "Analysis unavailable: the model output failed evidence validation.",
  REFUSED: "Analysis unavailable: the model declined this request.",
};

/**
 * Owner check → shared DB rate limit (also records the attempt) → bounded model
 * call → run completion with real model ID and usage. Only validated items are
 * returned or stored; failures are recorded and surface as 503.
 */
export async function analyseRequest(
  repo: OwnerRepository,
  projectId: string,
  requestText: string,
  ai: { create: CreateMessage; modelId: string; deadlineMs?: number } | null,
): Promise<AnalysisResponse> {
  if (!uuidSchema.safeParse(projectId).success) throw new AppError("NOT_FOUND");
  const project = await repo.getProject(projectId);
  if (!project) throw new AppError("NOT_FOUND");
  if (!ai) throw new AppError("ANALYSIS_UNAVAILABLE", "Analysis unavailable: no model is configured on this deployment. Enter items manually.");

  const requestHash = sha256Hex(JSON.stringify({ baseline: project.baselineItems, requestText }));
  const runId = await repo.beginAnalysisRun(project.id, requestHash);

  const outcome = await extractScopeChanges({
    create: ai.create,
    modelId: ai.modelId,
    baseline: project.baselineItems,
    requestText,
    deadlineMs: ai.deadlineMs,
  });

  await repo.completeAnalysisRun({
    runId,
    status: outcome.ok ? "success" : "failure",
    validatedResult: outcome.ok ? outcome.value : null,
    modelId: outcome.modelId,
    tokenUsage: outcome.usage,
    failureCode: outcome.ok ? null : outcome.code,
    attempts: outcome.attempts,
  });

  if (!outcome.ok) throw new AppError("ANALYSIS_UNAVAILABLE", FAILURE_MESSAGE[outcome.code]);
  const { items, missingInformation } = outcome.value;
  return {
    runId,
    items,
    missingInformation,
    needsJudgment: missingInformation.length > 0 || items.some((i) => i.classification !== "potential_addition"),
    modelId: outcome.modelId,
  };
}
