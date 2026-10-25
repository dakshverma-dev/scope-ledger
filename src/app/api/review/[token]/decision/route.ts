import { reviewRepository } from "@/lib/db/admin";
import { decisionSchema } from "@/lib/domain/validation";
import { appBaseUrl } from "@/lib/env";
import { assertSameOrigin } from "@/lib/http/origin";
import { json, readJson, route } from "@/lib/http/route";
import { submitDecision } from "@/lib/services/review";

export const dynamic = "force-dynamic";

/**
 * Body: { decision: "accepted" | "revision_requested", declaredName, note? }.
 * 201 = recorded; 200 = identical replay; 409 = a different decision exists.
 */
export const POST = route(async (request: Request, ctx: { params: Promise<{ token: string }> }) => {
  assertSameOrigin(request, appBaseUrl());
  const { token } = await ctx.params;
  const input = await readJson(request, decisionSchema);
  const result = await submitDecision(reviewRepository(), token, input);
  return json(result, result.status === "created" ? 201 : 200);
});
