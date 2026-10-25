import type {
  ApprovedItem,
  ChangeVersion,
  DecisionEvent,
  DecisionResult,
  DecisionValue,
  Project,
  PublishResult,
  ReviewLinkInfo,
  ReviewSnapshot,
} from "@/lib/domain/types";
import type { CreateProjectInput } from "@/lib/domain/validation";

export interface PublishArgs {
  projectId: string;
  publishKey: string;
  expectedCurrentVersionId: string | null;
  requestText: string;
  approvedItems: ApprovedItem[];
  effortMinutes: number;
  revisedDueOn: string;
  tokenHash: string;
}

export interface CompleteRunArgs {
  runId: string;
  status: "success" | "failure";
  validatedResult: unknown;
  modelId: string | null;
  tokenUsage: unknown;
  failureCode: string | null;
  attempts: number;
}

/**
 * Data access for one signed-in visitor. Every implementation runs as that
 * visitor (RLS applies) and uses the transactional routines for all writes.
 */
export interface OwnerRepository {
  readonly userId: string;
  seedDemoProject(): Promise<string>;
  createProject(input: CreateProjectInput): Promise<string>;
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | null>;
  listVersions(projectId: string): Promise<ChangeVersion[]>;
  getVersion(id: string): Promise<ChangeVersion | null>;
  listDecisions(versionIds: string[]): Promise<DecisionEvent[]>;
  getActiveLink(projectId: string): Promise<ReviewLinkInfo | null>;
  publish(args: PublishArgs): Promise<PublishResult>;
  beginAnalysisRun(projectId: string, requestHash: string): Promise<string>;
  completeAnalysisRun(args: CompleteRunArgs): Promise<void>;
}

/** Bearer-token access. Only server code holding the service-role key implements this. */
export interface ReviewRepository {
  getSnapshot(tokenHash: string): Promise<ReviewSnapshot | null>;
  recordDecision(args: {
    tokenHash: string;
    decision: DecisionValue;
    declaredName: string;
    note: string | null;
  }): Promise<DecisionResult>;
}
