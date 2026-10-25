import type { ApprovedItem, Classification } from "@/lib/domain/types";

/** An editable change item. `included` and `reason` are editor-only and never published. */
export interface EditorItem extends ApprovedItem {
  included: boolean;
  reason: string | null;
}

export interface Draft {
  v: 1;
  /** Idempotency key, generated once per draft and reused for every publish retry. */
  publishKey: string;
  /** Current version when the draft started (stale-publish detection). */
  expectedCurrentVersionId: string | null;
  /** Version this draft was copied from, if any. */
  sourceVersionId: string | null;
  requestText: string;
  items: EditorItem[];
  effortMinutes: string;
  revisedDueOn: string;
  missingInformation: string[];
  analysisRunId: string | null;
  updatedAt: string;
}

const key = (projectId: string) => `scope-ledger:draft:${projectId}`;

export function loadDraft(projectId: string): Draft | null {
  try {
    const raw = window.localStorage.getItem(key(projectId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    return d && d.v === 1 && typeof d.publishKey === "string" && Array.isArray(d.items) ? d : null;
  } catch {
    return null;
  }
}

export function saveDraft(projectId: string, draft: Draft): void {
  try {
    window.localStorage.setItem(key(projectId), JSON.stringify(draft));
  } catch {
    // Storage full or blocked: the in-memory draft still works for this session.
  }
}

export function clearDraft(projectId: string): void {
  try {
    window.localStorage.removeItem(key(projectId));
  } catch {
    /* ignore */
  }
}

/** The one-time review URL is held in sessionStorage only, so it is not left on disk. */
export function rememberReviewUrl(versionId: string, url: string): void {
  try {
    window.sessionStorage.setItem(`scope-ledger:link:${versionId}`, url);
  } catch {
    /* ignore */
  }
}

export function recallReviewUrl(versionId: string): string | null {
  try {
    return window.sessionStorage.getItem(`scope-ledger:link:${versionId}`);
  } catch {
    return null;
  }
}

export function newItemId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

export function defaultIncluded(c: Classification | null): boolean {
  return c === "potential_addition";
}
