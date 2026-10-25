import type {
  ApprovedItem,
  BaselineSnapshot,
  ChangeVersion,
  DecisionEvent,
  DecisionResult,
  Project,
  PublishResult,
  ReviewLinkInfo,
  ReviewSnapshot,
} from "@/lib/domain/types";

type Row = Record<string, unknown>;

/** Rows arrive as PostgREST-style JSON: dates "YYYY-MM-DD", timestamps ISO-8601. */
const iso = (v: unknown) => new Date(String(v)).toISOString();

export function projectFromRow(r: Row): Project {
  return {
    id: String(r.id),
    name: String(r.name),
    clientName: String(r.client_name),
    baselineItems: r.baseline_items as Project["baselineItems"],
    originalFeePence: Number(r.original_fee_pence),
    ratePence: Number(r.rate_pence),
    dueOn: String(r.due_on),
    currentVersionId: (r.current_version_id as string | null) ?? null,
    isDemo: r.seed_key === "northlight",
    archivedAt: r.archived_at ? iso(r.archived_at) : null,
    createdAt: iso(r.created_at),
  };
}

export function versionFromRow(r: Row): ChangeVersion {
  return {
    id: String(r.id),
    projectId: String(r.project_id),
    publishKey: String(r.publish_key),
    versionNumber: Number(r.version_number),
    baselineSnapshot: r.baseline_snapshot as BaselineSnapshot,
    requestText: String(r.request_text),
    approvedItems: r.approved_items as ApprovedItem[],
    effortMinutes: Number(r.effort_minutes),
    extraFeePence: Number(r.extra_fee_pence),
    revisedTotalPence: Number(r.revised_total_pence),
    revisedDueOn: String(r.revised_due_on),
    publishedAt: iso(r.published_at),
  };
}

export function decisionFromRow(r: Row): DecisionEvent {
  return {
    changeVersionId: String(r.change_version_id),
    decision: r.decision as DecisionEvent["decision"],
    declaredName: String(r.declared_name),
    note: (r.note as string | null) ?? null,
    decidedAt: iso(r.decided_at),
  };
}

export function linkFromRow(r: Row): ReviewLinkInfo {
  return {
    changeVersionId: String(r.change_version_id),
    expiresAt: iso(r.expires_at),
    createdAt: iso(r.created_at),
  };
}

export function publishResultFromJson(j: Row): PublishResult {
  return {
    versionId: String(j.versionId),
    versionNumber: Number(j.versionNumber),
    extraFeePence: Number(j.extraFeePence),
    revisedTotalPence: Number(j.revisedTotalPence),
    created: Boolean(j.created),
    linkExpiresAt: iso(j.linkExpiresAt),
  };
}

export function snapshotFromJson(j: Row): ReviewSnapshot {
  const d = j.decision as Row | null;
  return {
    versionNumber: Number(j.versionNumber),
    publishedAt: iso(j.publishedAt),
    linkExpiresAt: iso(j.linkExpiresAt),
    projectName: String(j.projectName),
    clientName: String(j.clientName),
    baselineItems: j.baselineItems as ReviewSnapshot["baselineItems"],
    originalFeePence: Number(j.originalFeePence),
    ratePence: Number(j.ratePence),
    originalDueOn: String(j.originalDueOn),
    approvedItems: j.approvedItems as ReviewSnapshot["approvedItems"],
    effortMinutes: Number(j.effortMinutes),
    extraFeePence: Number(j.extraFeePence),
    revisedTotalPence: Number(j.revisedTotalPence),
    revisedDueOn: String(j.revisedDueOn),
    decision: d
      ? {
          decision: d.decision as DecisionEvent["decision"],
          declaredName: String(d.declaredName),
          note: (d.note as string | null) ?? null,
          decidedAt: iso(d.decidedAt),
        }
      : null,
  };
}

export function decisionResultFromJson(j: Row): DecisionResult {
  return {
    status: j.status === "replayed" ? "replayed" : "created",
    decision: j.decision as DecisionResult["decision"],
    declaredName: String(j.declaredName),
    note: (j.note as string | null) ?? null,
    decidedAt: iso(j.decidedAt),
  };
}
