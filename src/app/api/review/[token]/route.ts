import { reviewRepository } from "@/lib/db/admin";
import { json, route } from "@/lib/http/route";
import { getReview } from "@/lib/services/review";

export const dynamic = "force-dynamic";

/** Bearer-only. Every invalid, expired, revoked or superseded token gets the same 404 body. */
export const GET = route(async (_request: Request, ctx: { params: Promise<{ token: string }> }) => {
  const { token } = await ctx.params;
  return json(await getReview(reviewRepository(), token), 200, { "X-Robots-Tag": "noindex" });
});
