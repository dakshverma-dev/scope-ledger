import { anthropicCreateMessage } from "@/lib/ai/extract";
import { requireOwnerRepository } from "@/lib/auth/session";
import { analyseSchema } from "@/lib/domain/validation";
import { anthropicConfig, appBaseUrl } from "@/lib/env";
import { assertSameOrigin } from "@/lib/http/origin";
import { json, readJson, route } from "@/lib/http/route";
import { analyseRequest } from "@/lib/services/analyse";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

export const POST = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(request, appBaseUrl());
  const repo = await requireOwnerRepository();
  const { id } = await ctx.params;
  const { requestText } = await readJson(request, analyseSchema);
  const config = anthropicConfig();
  const ai = config ? { create: anthropicCreateMessage(config.apiKey), modelId: config.modelId } : null;
  return json(await analyseRequest(repo, id, requestText, ai));
});
