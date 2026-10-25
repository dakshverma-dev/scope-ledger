import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
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

type Row = Record<string, unknown>;

function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw fromDbError(res.error);
  return res.data as T;
}

/** Visitor-scoped repository: `client` carries the visitor's JWT, so RLS applies. */
export function supabaseOwnerRepository(client: SupabaseClient, userId: string): OwnerRepository {
  return {
    userId,
    async seedDemoProject() {
      return unwrap(await client.rpc("seed_demo_project")) as string;
    },
    async createProject(i) {
      return unwrap(
        await client.rpc("create_project", {
          p_name: i.name,
          p_client_name: i.clientName,
          p_baseline_items: i.baselineItems,
          p_original_fee_pence: i.originalFeePence,
          p_rate_pence: i.ratePence,
          p_due_on: i.dueOn,
        }),
      ) as string;
    },
    async listProjects() {
      const rows = unwrap(await client.from("projects").select("*").order("created_at", { ascending: false }));
      return (rows as Row[]).map(projectFromRow);
    },
    async getProject(id) {
      const row = unwrap(await client.from("projects").select("*").eq("id", id).maybeSingle());
      return row ? projectFromRow(row as Row) : null;
    },
    async listVersions(projectId) {
      const rows = unwrap(
        await client.from("change_versions").select("*").eq("project_id", projectId).order("version_number", { ascending: false }),
      );
      return (rows as Row[]).map(versionFromRow);
    },
    async getVersion(id) {
      const row = unwrap(await client.from("change_versions").select("*").eq("id", id).maybeSingle());
      return row ? versionFromRow(row as Row) : null;
    },
    async listDecisions(versionIds) {
      if (versionIds.length === 0) return [];
      const rows = unwrap(
        await client
          .from("decision_events")
          .select("change_version_id, decision, declared_name, note, decided_at")
          .in("change_version_id", versionIds),
      );
      return (rows as Row[]).map(decisionFromRow);
    },
    async getActiveLink(projectId) {
      const row = unwrap(
        await client
          .from("review_tokens")
          .select("change_version_id, expires_at, created_at")
          .eq("project_id", projectId)
          .is("revoked_at", null)
          .maybeSingle(),
      );
      return row ? linkFromRow(row as Row) : null;
    },
    async publish(a) {
      const json = unwrap(
        await client.rpc("publish_change_version", {
          p_project_id: a.projectId,
          p_publish_key: a.publishKey,
          p_expected_current_version_id: a.expectedCurrentVersionId,
          p_request_text: a.requestText,
          p_approved_items: a.approvedItems,
          p_effort_minutes: a.effortMinutes,
          p_revised_due_on: a.revisedDueOn,
          p_token_hash: a.tokenHash,
        }),
      );
      return publishResultFromJson(json as Row);
    },
    async beginAnalysisRun(projectId, requestHash) {
      return unwrap(await client.rpc("begin_analysis_run", { p_project_id: projectId, p_request_hash: requestHash })) as string;
    },
    async completeAnalysisRun(a) {
      unwrap(
        await client.rpc("complete_analysis_run", {
          p_run_id: a.runId,
          p_status: a.status,
          p_validated_result: a.validatedResult ?? null,
          p_model_id: a.modelId,
          p_token_usage: a.tokenUsage ?? null,
          p_failure_code: a.failureCode,
          p_attempts: a.attempts,
        }),
      );
    },
  };
}

/** `admin` must be the service-role client from ./admin. Only token-checked routines are called. */
export function supabaseReviewRepository(admin: SupabaseClient): ReviewRepository {
  return {
    async getSnapshot(tokenHash) {
      const json = unwrap(await admin.rpc("get_review_snapshot", { p_token_hash: tokenHash }));
      return json ? snapshotFromJson(json as Row) : null;
    },
    async recordDecision(a) {
      const json = unwrap(
        await admin.rpc("record_review_decision", {
          p_token_hash: a.tokenHash,
          p_decision: a.decision,
          p_declared_name: a.declaredName,
          p_note: a.note,
        }),
      );
      return decisionResultFromJson(json as Row);
    },
  };
}
