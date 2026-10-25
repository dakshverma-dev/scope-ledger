import type { ApprovedItem, Classification, DecisionValue } from "./validation";

export type { ApprovedItem, Classification, DecisionValue };

export interface BaselineItem {
  id: string;
  text: string;
}

export interface Project {
  id: string;
  name: string;
  clientName: string;
  baselineItems: BaselineItem[];
  originalFeePence: number;
  ratePence: number;
  dueOn: string;
  currentVersionId: string | null;
  isDemo: boolean;
  archivedAt: string | null;
  createdAt: string;
}

export interface BaselineSnapshot {
  projectName: string;
  clientName: string;
  baselineItems: BaselineItem[];
  originalFeePence: number;
  ratePence: number;
  dueOn: string;
  currency: "GBP";
}

export interface ChangeVersion {
  id: string;
  projectId: string;
  publishKey: string;
  versionNumber: number;
  baselineSnapshot: BaselineSnapshot;
  requestText: string;
  approvedItems: ApprovedItem[];
  effortMinutes: number;
  extraFeePence: number;
  revisedTotalPence: number;
  revisedDueOn: string;
  publishedAt: string;
}

export interface DecisionEvent {
  changeVersionId: string;
  decision: DecisionValue;
  declaredName: string;
  note: string | null;
  decidedAt: string;
}

export interface ReviewLinkInfo {
  changeVersionId: string;
  expiresAt: string;
  createdAt: string;
}

export interface PublishResult {
  versionId: string;
  versionNumber: number;
  extraFeePence: number;
  revisedTotalPence: number;
  created: boolean;
  linkExpiresAt: string;
}

/** Exactly what an account-free reviewer may see. */
export interface ReviewSnapshot {
  versionNumber: number;
  publishedAt: string;
  linkExpiresAt: string;
  projectName: string;
  clientName: string;
  baselineItems: BaselineItem[];
  originalFeePence: number;
  ratePence: number;
  originalDueOn: string;
  approvedItems: { description: string; baselineItemIds: string[] }[];
  effortMinutes: number;
  extraFeePence: number;
  revisedTotalPence: number;
  revisedDueOn: string;
  decision: Omit<DecisionEvent, "changeVersionId"> | null;
}

export interface DecisionResult {
  status: "created" | "replayed";
  decision: DecisionValue;
  declaredName: string;
  note: string | null;
  decidedAt: string;
}

export type VersionStatus = "awaiting_decision" | "accepted" | "revision_requested" | "superseded";
