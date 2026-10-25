import { fromDbError } from "./errors";
import {
  decisionFromRow,
  decisionResultFromJson,
  linkFromRow,
  projectFromRow,
  publishResultFromJson,
  snapshotFromJson,
  versionFromRow,
} from "./mappers";
import type { OwnerRepository, ReviewRepository } from "./repository";

/** Calls one database routine by name with named arguments and returns its JSON result. */
export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>;

type Row = Record<string, unknown>;

async function call<T>(rpc: Rpc, fn: string, args: Record<string, unknown>): Promise<T> {
  try {
    return (await rpc(fn, args)) as T;
  } catch (err) {
    throw fromDbError(err);
  }
}

/**
 * Data access for one visitor. Every call passes the visitor ID to a routine
 * that filters or checks ownership in SQL; there are no direct table reads.
 */
export function ownerRepository(rpc: Rpc, visitorId: string): OwnerRepository {
  const v = { p_visitor_id: visitorId };
  return {
    userId: visitorId,
    async seedDemoProject() {
      return call<string>(rpc, "seed_demo_project", v);
    },
    async createProject(i) {
      return call<string>(rpc, "create_project", {
        ...v,
        p_name: i.name,
        p_client_name: i.clientName,
        p_baseline_items: i.baselineItems,
        p_original_fee_pence: i.originalFeePence,
        p_rate_pence: i.ratePence,
        p_due_on: i.dueOn,
      });
    },
    async listProjects() {
      return (await call<Row[]>(rpc, "owner_list_projects", v)).map(projectFromRow);
    },
    async getProject(id) {
      const row = await call<Row | null>(rpc, "owner_get_project", { ...v, p_project_id: id });
      return row ? projectFromRow(row) : null;
    },
    async listVersions(projectId) {
      return (await call<Row[]>(rpc, "owner_list_versions", { ...v, p_project_id: projectId })).map(versionFromRow);
    },
    async getVersion(id) {
      const row = await call<Row | null>(rpc, "owner_get_version", { ...v, p_version_id: id });
      return row ? versionFromRow(row) : null;
    },
    async listDecisions(projectId) {
      return (await call<Row[]>(rpc, "owner_list_decisions", { ...v, p_project_id: projectId })).map(decisionFromRow);
    },
    async getActiveLink(projectId) {
      const row = await call<Row | null>(rpc, "owner_get_active_link", { ...v, p_project_id: projectId });
      return row ? linkFromRow(row) : null;
    },
    async publish(a) {
      const json = await call<Row>(rpc, "publish_change_version", {
        ...v,
        p_project_id: a.projectId,
        p_publish_key: a.publishKey,
        p_expected_current_version_id: a.expectedCurrentVersionId,
        p_request_text: a.requestText,
        p_approved_items: a.approvedItems,
        p_effort_minutes: a.effortMinutes,
        p_revised_due_on: a.revisedDueOn,
        p_token_hash: a.tokenHash,
      });
      return publishResultFromJson(json);
    },
    async beginAnalysisRun(projectId, requestHash) {
      return call<string>(rpc, "begin_analysis_run", { ...v, p_project_id: projectId, p_request_hash: requestHash });
    },
    async completeAnalysisRun(a) {
      await call(rpc, "complete_analysis_run", {
        ...v,
        p_run_id: a.runId,
        p_status: a.status,
        p_validated_result: a.validatedResult ?? null,
        p_model_id: a.modelId,
        p_token_usage: a.tokenUsage ?? null,
        p_failure_code: a.failureCode,
        p_attempts: a.attempts,
      });
    },
  };
}

/** Bearer-token access: only the two token-checked routines. */
export function reviewRepository(rpc: Rpc): ReviewRepository {
  return {
    async getSnapshot(tokenHash) {
      const json = await call<Row | null>(rpc, "get_review_snapshot", { p_token_hash: tokenHash });
      return json ? snapshotFromJson(json) : null;
    },
    async recordDecision(a) {
      const json = await call<Row>(rpc, "record_review_decision", {
        p_token_hash: a.tokenHash,
        p_decision: a.decision,
        p_declared_name: a.declaredName,
        p_note: a.note,
      });
      return decisionResultFromJson(json);
    },
  };
}

/** Resolves (or with `create`, registers) the visitor whose cookie secret hashes to `secretHash`. */
export async function resolveVisitor(rpc: Rpc, secretHash: string, create: boolean): Promise<string | null> {
  return call<string | null>(rpc, "resolve_visitor", { p_secret_hash: secretHash, p_create: create });
}
