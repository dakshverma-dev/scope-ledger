import { requireOwnerRepository } from "@/lib/auth/session";
import { createProjectSchema } from "@/lib/domain/validation";
import { appBaseUrl } from "@/lib/env";
import { assertSameOrigin } from "@/lib/http/origin";
import { json, readJson, route } from "@/lib/http/route";
import { createProject } from "@/lib/services/workspace";

export const dynamic = "force-dynamic";

export const POST = route(async (request: Request) => {
  assertSameOrigin(request, appBaseUrl());
  const repo = await requireOwnerRepository();
  const input = await readJson(request, createProjectSchema);
  const projectId = await createProject(repo, input);
  return json({ projectId }, 201);
});
