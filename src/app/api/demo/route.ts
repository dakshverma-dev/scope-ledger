import { ensureAnonymousVisitor } from "@/lib/auth/session";
import { appBaseUrl } from "@/lib/env";
import { assertSameOrigin } from "@/lib/http/origin";
import { json, route } from "@/lib/http/route";
import { startDemo } from "@/lib/services/workspace";

export const dynamic = "force-dynamic";

/** Creates or resumes the anonymous visitor, then idempotently seeds Northlight. */
export const POST = route(async (request: Request) => {
  assertSameOrigin(request, appBaseUrl());
  const repo = await ensureAnonymousVisitor();
  const projectId = await startDemo(repo);
  return json({ projectId });
});
