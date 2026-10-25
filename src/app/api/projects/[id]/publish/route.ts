import { requireOwnerRepository } from "@/lib/auth/session";
import { publishSchema } from "@/lib/domain/validation";
import { appBaseUrl } from "@/lib/env";
import { assertSameOrigin } from "@/lib/http/origin";
import { json, readJson, route } from "@/lib/http/route";
import { publishChange, reviewUrl } from "@/lib/services/publish";

export const dynamic = "force-dynamic";

/**
 * Body: { publishKey, expectedCurrentVersionId, requestText, approvedItems,
 * effortMinutes, revisedDueOn, confirmed: true }. No money field is accepted.
 * 201 = new version committed; 200 = idempotent retry (same version, fresh link).
 */
export const POST = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const base = appBaseUrl();
  assertSameOrigin(request, base);
  const repo = await requireOwnerRepository();
  const { id } = await ctx.params;
  const input = await readJson(request, publishSchema);
  const { reviewToken, ...result } = await publishChange(repo, id, input);
  return json({ ...result, reviewUrl: reviewUrl(base ?? new URL(request.url).origin, reviewToken) }, result.created ? 201 : 200);
});
