import { ensureVisitor } from "@/lib/auth/session";
import { appBaseUrl } from "@/lib/env";
import { assertSameOrigin } from "@/lib/http/origin";
import { json, route } from "@/lib/http/route";
import { startDemo } from "@/lib/services/workspace";

export const dynamic = "force-dynamic";

/** Creates or resumes this browser's workspace, then idempotently seeds Northlight. */
export const POST = route(async (request: Request) => {
  assertSameOrigin(request, appBaseUrl());
  const repo = await ensureVisitor();
  const projectId = await startDemo(repo);
  return json({ projectId });
});
