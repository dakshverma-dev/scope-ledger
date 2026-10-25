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
 * Data access for one visitor workspace. Every call goes through a routine
 * that checks the visitor ID; writes are single transactional routines.
 */
export interface OwnerRepository {
  readonly userId: string;
  seedDemoProject(): Promise<string>;
  createProject(input: CreateProjectInput): Promise<string>;
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | null>;
  listVersions(projectId: string): Promise<ChangeVersion[]>;
  getVersion(id: string): Promise<ChangeVersion | null>;
  /** Decisions for all versions of one of this visitor's projects. */
  listDecisions(projectId: string): Promise<DecisionEvent[]>;
  getActiveLink(projectId: string): Promise<ReviewLinkInfo | null>;
  publish(args: PublishArgs): Promise<PublishResult>;
  beginAnalysisRun(projectId: string, requestHash: string): Promise<string>;
  completeAnalysisRun(args: CompleteRunArgs): Promise<void>;
}

/** Bearer-token access through the two token-checked routines. */
export interface ReviewRepository {
  getSnapshot(tokenHash: string): Promise<ReviewSnapshot | null>;
  recordDecision(args: {
    tokenHash: string;
    decision: DecisionValue;
    declaredName: string;
    note: string | null;
  }): Promise<DecisionResult>;
}
