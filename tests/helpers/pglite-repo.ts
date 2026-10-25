import { fromDbError } from "@/lib/db/errors";
import {
  decisionFromRow,
  decisionResultFromJson,
  linkFromRow,
  projectFromRow,
  publishResultFromJson,
  snapshotFromJson,
  versionFromRow,
} from "@/lib/db/mappers";
import type { OwnerRepository, ReviewRepository } from "@/lib/db/repository";
import type { TestDb } from "./db";

type Row = Record<string, unknown>;

/**
 * TEST FIXTURE. Same contract as src/lib/db/supabase-repository.ts but executed
 * against PGlite as the `authenticated` role with the visitor's JWT claims, so
 * RLS, grants and routines are the real migration's. `to_jsonb` yields the same
 * JSON shapes PostgREST returns.
 */
export function pgliteOwnerRepository(db: TestDb, userId: string): OwnerRepository {
  const q = async (sql: string, params: unknown[] = []) => {
    try {
      return await db.asUser<Row>(userId, sql, params);
    } catch (err) {
      throw fromDbError(err);
    }
  };
  const one = async (sql: string, params: unknown[] = []) => (await q(sql, params))[0];

  return {
    userId,
    async seedDemoProject() {
      return String((await one("select public.seed_demo_project() as v")).v);
    },
    async createProject(i) {
      const r = await one("select public.create_project($1, $2, $3::jsonb, $4, $5, $6::date) as v", [
        i.name,
        i.clientName,
        JSON.stringify(i.baselineItems),
        i.originalFeePence,
        i.ratePence,
        i.dueOn,
      ]);
      return String(r.v);
    },
    async listProjects() {
      const rows = await q("select to_jsonb(p) as r from public.projects p order by created_at desc");
      return rows.map((r) => projectFromRow(r.r as Row));
    },
    async getProject(id) {
      const r = await one("select to_jsonb(p) as r from public.projects p where id = $1", [id]);
      return r ? projectFromRow(r.r as Row) : null;
    },
    async listVersions(projectId) {
      const rows = await q(
        "select to_jsonb(v) as r from public.change_versions v where project_id = $1 order by version_number desc",
        [projectId],
      );
      return rows.map((r) => versionFromRow(r.r as Row));
    },
    async getVersion(id) {
      const r = await one("select to_jsonb(v) as r from public.change_versions v where id = $1", [id]);
      return r ? versionFromRow(r.r as Row) : null;
    },
    async listDecisions(ids) {
      if (!ids.length) return [];
      const rows = await q(
        "select to_jsonb(d) - 'review_token_id' - 'id' as r from public.decision_events d where change_version_id = any($1::uuid[])",
        [ids],
      );
      return rows.map((r) => decisionFromRow(r.r as Row));
    },
    async getActiveLink(projectId) {
      const r = await one(
        "select jsonb_build_object('change_version_id', change_version_id, 'expires_at', expires_at, 'created_at', created_at) as r from public.review_tokens where project_id = $1 and revoked_at is null",
        [projectId],
      );
      return r ? linkFromRow(r.r as Row) : null;
    },
    async publish(a) {
      const r = await one("select public.publish_change_version($1, $2, $3, $4, $5::jsonb, $6, $7::date, $8) as v", [
        a.projectId,
        a.publishKey,
        a.expectedCurrentVersionId,
        a.requestText,
        JSON.stringify(a.approvedItems),
        a.effortMinutes,
        a.revisedDueOn,
        a.tokenHash,
      ]);
      return publishResultFromJson(r.v as Row);
    },
    async beginAnalysisRun(projectId, hash) {
      return String((await one("select public.begin_analysis_run($1, $2) as v", [projectId, hash])).v);
    },
    async completeAnalysisRun(a) {
      await q("select public.complete_analysis_run($1, $2, $3::jsonb, $4, $5::jsonb, $6, $7)", [
        a.runId,
        a.status,
        a.validatedResult == null ? null : JSON.stringify(a.validatedResult),
        a.modelId,
        a.tokenUsage == null ? null : JSON.stringify(a.tokenUsage),
        a.failureCode,
        a.attempts,
      ]);
    },
  };
}

export function pgliteReviewRepository(db: TestDb): ReviewRepository {
  const one = async (sql: string, params: unknown[]) => {
    try {
      return (await db.asService<Row>(sql, params))[0];
    } catch (err) {
      throw fromDbError(err);
    }
  };
  return {
    async getSnapshot(hash) {
      const r = await one("select public.get_review_snapshot($1) as v", [hash]);
      return r.v ? snapshotFromJson(r.v as Row) : null;
    },
    async recordDecision(a) {
      const r = await one("select public.record_review_decision($1, $2, $3, $4) as v", [
        a.tokenHash,
        a.decision,
        a.declaredName,
        a.note,
      ]);
      return decisionResultFromJson(r.v as Row);
    },
  };
}
