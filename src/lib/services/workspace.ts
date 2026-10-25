import type { OwnerRepository } from "@/lib/db/repository";
import type { ChangeVersion, DecisionEvent, Project, ReviewLinkInfo, VersionStatus } from "@/lib/domain/types";
import { uuidSchema, type CreateProjectInput } from "@/lib/domain/validation";
import { AppError } from "@/lib/http/errors";

export interface VersionWithStatus {
  version: ChangeVersion;
  decision: DecisionEvent | null;
  status: VersionStatus;
}

export interface ProjectOverview {
  project: Project;
  versions: VersionWithStatus[];
  current: VersionWithStatus | null;
  activeLink: ReviewLinkInfo | null;
}

export function versionStatus(version: ChangeVersion, decision: DecisionEvent | null, project: Project): VersionStatus {
  if (decision) return decision.decision;
  return project.currentVersionId === version.id ? "awaiting_decision" : "superseded";
}

/** Unknown, malformed and other-owner IDs all look the same: not found. */
export async function getProjectOverview(repo: OwnerRepository, projectId: string): Promise<ProjectOverview> {
  if (!uuidSchema.safeParse(projectId).success) throw new AppError("NOT_FOUND");
  const project = await repo.getProject(projectId);
  if (!project) throw new AppError("NOT_FOUND");
  const [versions, activeLink, decisions] = await Promise.all([
    repo.listVersions(project.id),
    repo.getActiveLink(project.id),
    repo.listDecisions(project.id),
  ]);
  const byVersion = new Map(decisions.map((d) => [d.changeVersionId, d]));
  const withStatus = versions.map((version) => {
    const decision = byVersion.get(version.id) ?? null;
    return { version, decision, status: versionStatus(version, decision, project) };
  });
  return {
    project,
    versions: withStatus,
    current: withStatus.find((v) => v.version.id === project.currentVersionId) ?? null,
    activeLink: activeLink && activeLink.changeVersionId === project.currentVersionId ? activeLink : null,
  };
}

export interface VersionDetail {
  project: Project;
  entry: VersionWithStatus;
  activeLink: ReviewLinkInfo | null;
}

export async function getVersionDetail(repo: OwnerRepository, versionId: string): Promise<VersionDetail> {
  if (!uuidSchema.safeParse(versionId).success) throw new AppError("NOT_FOUND");
  const version = await repo.getVersion(versionId);
  if (!version) throw new AppError("NOT_FOUND");
  const project = await repo.getProject(version.projectId);
  if (!project) throw new AppError("NOT_FOUND");
  const [decisions, activeLink] = await Promise.all([repo.listDecisions(project.id), repo.getActiveLink(project.id)]);
  const decision = decisions.find((d) => d.changeVersionId === version.id) ?? null;
  return {
    project,
    entry: { version, decision, status: versionStatus(version, decision, project) },
    activeLink: activeLink && activeLink.changeVersionId === version.id ? activeLink : null,
  };
}

export async function startDemo(repo: OwnerRepository): Promise<string> {
  return repo.seedDemoProject();
}

export async function createProject(repo: OwnerRepository, input: CreateProjectInput): Promise<string> {
  return repo.createProject(input);
}
