"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { MarkedRequest } from "@/components/MarkedRequest";
import {
  clearDraft,
  defaultIncluded,
  loadDraft,
  newItemId,
  rememberReviewUrl,
  saveDraft,
  type Draft,
  type EditorItem,
} from "@/lib/client/draft";
import { extraFeePence, formatDate, formatEffort, formatGBP, revisedTotalPence } from "@/lib/domain/money";
import type { ApprovedItem, BaselineItem, Classification } from "@/lib/domain/types";
import { LIMITS, publishSchema } from "@/lib/domain/validation";

export interface EditorProject {
  id: string;
  name: string;
  clientName: string;
  baselineItems: BaselineItem[];
  originalFeePence: number;
  ratePence: number;
  dueOn: string;
}

export interface EditorSource {
  versionId: string;
  versionNumber: number;
  requestText: string;
  approvedItems: ApprovedItem[];
  effortMinutes: number;
  revisedDueOn: string;
}

interface Props {
  project: EditorProject;
  currentVersionId: string | null;
  nextVersionNumber: number;
  source: EditorSource | null;
}

type AnalysisState =
  | { kind: "idle" }
  | { kind: "analysing" }
  | { kind: "done"; count: number }
  | { kind: "unavailable"; message: string };

const CLASS_LABEL: Record<Classification, string> = {
  potential_addition: "Potential addition",
  clarification: "Clarification",
  unclear: "Unclear",
};

function freshDraft(currentVersionId: string | null, source: EditorSource | null): Draft {
  return {
    v: 1,
    publishKey: crypto.randomUUID(),
    expectedCurrentVersionId: currentVersionId,
    sourceVersionId: source?.versionId ?? null,
    requestText: source?.requestText ?? "",
    items: (source?.approvedItems ?? []).map((i) => ({ ...i, included: true, reason: null })),
    effortMinutes: source ? String(source.effortMinutes) : "",
    revisedDueOn: source?.revisedDueOn ?? "",
    missingInformation: [],
    analysisRunId: null,
    updatedAt: new Date().toISOString(),
  };
}

export function ChangeEditor({ project, currentVersionId, nextVersionNumber, source }: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => freshDraft(currentVersionId, source));
  const [restored, setRestored] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisState>({ kind: "idle" });
  const [confirming, setConfirming] = useState(false);
  const [approved, setApproved] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<{ message: string; stale: boolean } | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const confirmRef = useRef<HTMLDivElement>(null);

  // Restore an unsent local draft after hydration (never during server render).
  // localStorage is an external system, so syncing from it in an effect is intended.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const stored = loadDraft(project.id);
    if (stored && (!source || stored.sourceVersionId === source.versionId)) {
      if (stored.expectedCurrentVersionId !== currentVersionId) {
        setDraft({ ...stored, expectedCurrentVersionId: currentVersionId, publishKey: crypto.randomUUID() });
        setRestored("Restored your unsent draft. A newer version was published since it was started, so it will publish as the next version.");
      } else {
        setDraft(stored);
        setRestored("Restored your unsent draft from this device.");
      }
    }
    setHydrated(true);
    // Runs once on mount by design; later prop changes come with a fresh page render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (hydrated) saveDraft(project.id, draft);
  }, [draft, hydrated, project.id]);

  const update = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch, updatedAt: new Date().toISOString() }));
    setConfirming(false);
    setApproved(false);
    setPublishError(null);
  };
  const updateItem = (id: string, patch: Partial<EditorItem>) =>
    update({ items: draft.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });

  const included = draft.items.filter((i) => i.included);
  const effort = Number(draft.effortMinutes);
  const effortValid = Number.isInteger(effort) && effort >= LIMITS.effortMin && effort <= LIMITS.effortMax && effort % 15 === 0;

  const payload = useMemo(
    () => ({
      publishKey: draft.publishKey,
      expectedCurrentVersionId: draft.expectedCurrentVersionId,
      requestText: draft.requestText,
      approvedItems: included.map(({ id, description, baselineItemIds, origin, sourceQuote, classification }) => ({
        id,
        description: description.trim(),
        baselineItemIds,
        origin,
        sourceQuote,
        classification,
      })),
      effortMinutes: effort,
      revisedDueOn: draft.revisedDueOn,
      confirmed: true as const,
    }),
    [draft, included, effort],
  );

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!draft.requestText.trim()) e.request = "Paste the client's request.";
    if (draft.requestText.length > LIMITS.requestMax) e.request = `Keep the request under ${LIMITS.requestMax.toLocaleString()} characters.`;
    if (included.length === 0) e.items = "Approve at least one change item.";
    if (included.length > LIMITS.approvedItemsMax) e.items = "Approve at most 10 items.";
    if (included.some((i) => !i.description.trim())) e.items = "Every approved item needs a description.";
    if (!effortValid) e.effort = "Enter 15–2,400 minutes in 15-minute steps (for example 90).";
    if (!draft.revisedDueOn) e.date = "Choose the revised due date.";
    else if (draft.revisedDueOn < project.dueOn) e.date = `The revised date cannot be before ${formatDate(project.dueOn)}.`;
    if (Object.keys(e).length === 0 && !publishSchema.safeParse(payload).success) e.form = "Some fields are invalid.";
    return e;
  }, [draft, included, effortValid, project.dueOn, payload]);
  const ready = Object.keys(errors).length === 0;

  const needsJudgment =
    draft.missingInformation.length > 0 || draft.items.some((i) => i.origin === "ai_suggested" && i.classification !== "potential_addition");

  const fee = effortValid ? extraFeePence(project.ratePence, effort) : null;

  async function analyse() {
    if (!draft.requestText.trim() || draft.requestText.length > LIMITS.requestMax) {
      setShowErrors(true);
      return;
    }
    setAnalysis({ kind: "analysing" });
    try {
      const res = await fetch(`/api/projects/${project.id}/analyse`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestText: draft.requestText }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.items) {
        setAnalysis({ kind: "unavailable", message: body?.error?.message ?? "The analysis service did not respond." });
        return;
      }
      const aiItems: EditorItem[] = body.items.map(
        (c: { requestedChange: string; sourceQuote: string; baselineItemIds: string[]; classification: Classification; reason: string }) => ({
          id: newItemId("ai"),
          description: c.requestedChange,
          baselineItemIds: c.baselineItemIds,
          origin: "ai_suggested" as const,
          sourceQuote: c.sourceQuote,
          classification: c.classification,
          included: defaultIncluded(c.classification),
          reason: c.reason,
        }),
      );
      update({
        items: [...aiItems, ...draft.items.filter((i) => i.origin === "manually_entered")],
        missingInformation: body.missingInformation ?? [],
        analysisRunId: body.runId ?? null,
      });
      setAnalysis({ kind: "done", count: aiItems.length });
    } catch {
      setAnalysis({ kind: "unavailable", message: "Network error. Your draft is saved on this device." });
    }
  }

  function addManual() {
    update({
      items: [
        ...draft.items,
        {
          id: newItemId("m"),
          description: "",
          baselineItemIds: [],
          origin: "manually_entered",
          sourceQuote: null,
          classification: null,
          included: true,
          reason: null,
        },
      ],
    });
  }

  function openConfirm() {
    setShowErrors(true);
    if (!ready) return;
    setConfirming(true);
    setApproved(false);
    requestAnimationFrame(() => confirmRef.current?.focus());
  }

  async function publish() {
    if (!ready || !approved) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.versionId && body?.reviewUrl) {
        // Only now, after the transaction committed, is the draft discarded.
        rememberReviewUrl(body.versionId, body.reviewUrl);
        clearDraft(project.id);
        router.push(`/app/changes/${body.versionId}?published=1`);
        return;
      }
      setPublishError({
        message: `Not published. ${body?.error?.message ?? "The server did not confirm the publication."} Your draft is kept.`,
        stale: body?.error?.code === "STALE_VERSION",
      });
    } catch {
      setPublishError({ message: "Not published: the network request failed. Your draft is saved on this device; try again.", stale: false });
    }
    setPublishing(false);
  }

  function discard() {
    clearDraft(project.id);
    setDraft(freshDraft(currentVersionId, source));
    setRestored(null);
    setAnalysis({ kind: "idle" });
  }

  const baselineText = new Map(project.baselineItems.map((b) => [b.id, b.text]));
  const err = (k: string) => (showErrors ? errors[k] : undefined);
  const stateBadge = ready ? (
    <span className="status status-ready">Ready to publish</span>
  ) : needsJudgment ? (
    <span className="status status-judgment">Needs your judgment</span>
  ) : (
    <span className="status status-draft">Draft · not published</span>
  );

  return (
    <div className="grid-main">
      <div className="stack-lg">
        {restored && (
          <div className="notice notice-info" role="status">
            <span>{restored}</span>
            <span>
              <button type="button" className="btn btn-quiet" style={{ minHeight: 30, paddingLeft: 0 }} onClick={discard}>
                Discard draft and start over
              </button>
            </span>
          </div>
        )}
        {source && (
          <div className="notice">
            <strong>Revising from version {source.versionNumber}.</strong>
            <span>Version {source.versionNumber} stays exactly as published. This draft becomes version {nextVersionNumber}.</span>
          </div>
        )}

        <section className="card" aria-labelledby="baseline-h">
          <div className="card-head">
            <h2 id="baseline-h">Agreed baseline</h2>
            <span className="muted small">Fixed when the project was created</span>
          </div>
          <ul className="baseline">
            {project.baselineItems.map((b) => (
              <li key={b.id}>
                <span className="tag">{b.id}</span>
                <span>{b.text}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card stack" aria-labelledby="request-h">
          <div className="card-head" style={{ marginBottom: 0 }}>
            <h2 id="request-h">Client request</h2>
            <span className="counter" aria-live="polite">
              {draft.requestText.length.toLocaleString()} / {LIMITS.requestMax.toLocaleString()}
            </span>
          </div>
          <div className="field">
            <label htmlFor="request">Paste the new request exactly as the client wrote it</label>
            <textarea
              id="request"
              className="textarea"
              value={draft.requestText}
              maxLength={LIMITS.requestMax}
              aria-invalid={Boolean(err("request"))}
              aria-describedby="request-hint"
              onChange={(e) => update({ requestText: e.target.value })}
              placeholder="Please add two service pages and a second round of revisions."
            />
            <span id="request-hint" className="hint">
              The analysis only quotes this text. It never sets effort, price or dates.
            </span>
            {err("request") && <span className="field-error">{err("request")}</span>}
          </div>
          <div className="btn-row">
            <button type="button" className="btn btn-primary" onClick={analyse} disabled={analysis.kind === "analysing"} aria-busy={analysis.kind === "analysing"}>
              {analysis.kind === "analysing" ? "Analysing…" : "Analyse request"}
            </button>
            <button type="button" className="btn" onClick={addManual} disabled={draft.items.length >= LIMITS.approvedItemsMax + 5}>
              Add item manually
            </button>
          </div>
          <div aria-live="polite">
            {analysis.kind === "analysing" && (
              <div className="notice notice-info">
                <strong>Analysing</strong>
                <span>Comparing the request with B-items. This takes up to 30 seconds.</span>
              </div>
            )}
            {analysis.kind === "unavailable" && (
              <div className="notice notice-error" role="alert">
                <strong>Analysis unavailable</strong>
                <span>{analysis.message} Your request text is kept. Add the items manually below.</span>
              </div>
            )}
            {analysis.kind === "done" && (
              <div className="notice notice-ok">
                <strong>
                  {analysis.count === 0 ? "No concrete changes found" : `${analysis.count} candidate${analysis.count === 1 ? "" : "s"} found`}
                </strong>
                <span>Every candidate cites an exact quote. Check each one before approving it.</span>
              </div>
            )}
          </div>
          {draft.items.some((i) => i.sourceQuote) && (
            <div className="stack">
              <span className="label">Evidence in the request</span>
              <MarkedRequest text={draft.requestText} quotes={draft.items.map((i) => i.sourceQuote)} />
            </div>
          )}
          {draft.missingInformation.length > 0 && (
            <div className="notice notice-warn">
              <strong>Needs your judgment</strong>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {draft.missingInformation.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="card" aria-labelledby="items-h">
          <div className="card-head">
            <h2 id="items-h">Change items</h2>
            <span className="muted small">
              {included.length} of {draft.items.length} approved
            </span>
          </div>
          {draft.items.length === 0 && (
            <p className="muted">
              No items yet. Analyse the request, or add an item manually if analysis is unavailable or wrong.
            </p>
          )}
          {draft.items.map((item, idx) => (
            <article key={item.id} className="item" aria-label={`Item ${idx + 1}`}>
              <div className="item-head">
                <div className="btn-row" style={{ gap: 8 }}>
                  <span className="mono small">#{idx + 1}</span>
                  {item.origin === "ai_suggested" ? (
                    <span className="chip chip-ai">Suggested from request</span>
                  ) : (
                    <span className="chip chip-manual">Manually entered</span>
                  )}
                  {item.classification && <span className="chip">{CLASS_LABEL[item.classification]}</span>}
                </div>
                <button
                  type="button"
                  className="btn btn-danger-quiet"
                  onClick={() => update({ items: draft.items.filter((i) => i.id !== item.id) })}
                >
                  Remove
                </button>
              </div>
              <div className="stack">
                {item.sourceQuote && (
                  <blockquote className="quote">
                    <q>{item.sourceQuote}</q>
                    {item.reason && <div className="muted small" style={{ marginTop: 4 }}>{item.reason}</div>}
                  </blockquote>
                )}
                <div className="field">
                  <label htmlFor={`desc-${item.id}`}>Description shown to the client</label>
                  <input
                    id={`desc-${item.id}`}
                    className="input"
                    value={item.description}
                    maxLength={500}
                    onChange={(e) => updateItem(item.id, { description: e.target.value })}
                  />
                </div>
                <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="label" style={{ marginBottom: 6 }}>
                    Relates to baseline
                  </legend>
                  <div className="refs">
                    {project.baselineItems.map((b) => (
                      <label key={b.id} title={baselineText.get(b.id)}>
                        <input
                          type="checkbox"
                          checked={item.baselineItemIds.includes(b.id)}
                          onChange={(e) =>
                            updateItem(item.id, {
                              baselineItemIds: e.target.checked
                                ? [...item.baselineItemIds, b.id]
                                : item.baselineItemIds.filter((x) => x !== b.id),
                            })
                          }
                        />
                        {b.id}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="check">
                  <input type="checkbox" checked={item.included} onChange={(e) => updateItem(item.id, { included: e.target.checked })} />
                  <span>Approve this item for the proposal</span>
                </label>
              </div>
            </article>
          ))}
          {err("items") && <p className="field-error" style={{ marginTop: 10 }}>{err("items")}</p>}
        </section>

        <section className="card stack" aria-labelledby="terms-h">
          <h2 id="terms-h">Effort and date</h2>
          <p className="muted small">You decide these. They are not suggested by the analysis.</p>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="effort">Combined extra effort (minutes)</label>
              <input
                id="effort"
                className="input mono"
                type="number"
                inputMode="numeric"
                min={15}
                max={2400}
                step={15}
                value={draft.effortMinutes}
                aria-invalid={Boolean(err("effort"))}
                aria-describedby="effort-hint"
                onChange={(e) => update({ effortMinutes: e.target.value })}
              />
              <span id="effort-hint" className="hint">
                {effortValid ? `= ${formatEffort(effort)}` : "15-minute increments, up to 2,400 (40 hours)"}
              </span>
              {err("effort") && <span className="field-error">{err("effort")}</span>}
            </div>
            <div className="field">
              <label htmlFor="due">Revised due date</label>
              <input
                id="due"
                className="input mono"
                type="date"
                min={project.dueOn}
                value={draft.revisedDueOn}
                aria-invalid={Boolean(err("date"))}
                onChange={(e) => update({ revisedDueOn: e.target.value })}
              />
              <span className="hint">Original: {formatDate(project.dueOn)}</span>
              {err("date") && <span className="field-error">{err("date")}</span>}
            </div>
          </div>
        </section>
      </div>

      <aside className="sticky stack" aria-label="Proposal preview">
        <section className="card stack">
          <div className="card-head" style={{ marginBottom: 0 }}>
            <span className="eyebrow">Preview · version {nextVersionNumber}</span>
            {stateBadge}
          </div>
          <FeePreview project={project} effort={effortValid ? effort : null} fee={fee} revisedDueOn={draft.revisedDueOn} />
          <p className="hint">
            Preview only. The server recalculates the fee from the stored hourly rate when you publish; the client cannot
            change it.
          </p>
          {!confirming && (
            <button type="button" className="btn btn-primary" onClick={openConfirm}>
              Review and publish
            </button>
          )}
          {showErrors && !ready && !confirming && (
            <p className="field-error" role="alert">
              Fix the highlighted fields first.
            </p>
          )}
        </section>

        {confirming && (
          <section className="card stack" ref={confirmRef} tabIndex={-1} aria-labelledby="confirm-h">
            <h2 id="confirm-h">Publish version {nextVersionNumber}?</h2>
            <p className="muted small">
              Publishing saves an unchangeable copy of the baseline and these terms, and creates a private review link for
              {" "}{project.clientName}. Nothing is emailed; you share the link yourself.
            </p>
            <ol style={{ margin: 0, paddingLeft: 20 }}>
              {included.map((i) => (
                <li key={i.id}>
                  {i.description}
                  {i.baselineItemIds.length > 0 && <span className="mono small muted"> · {i.baselineItemIds.join(", ")}</span>}
                </li>
              ))}
            </ol>
            <label className="check">
              <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} />
              <span>
                I approve {formatEffort(effort)} of extra effort, an additional fee of {fee !== null && formatGBP(fee)} and a
                revised due date of {draft.revisedDueOn && formatDate(draft.revisedDueOn)}.
              </span>
            </label>
            <div className="btn-row">
              <button type="button" className="btn btn-primary" onClick={publish} disabled={!approved || publishing} aria-busy={publishing}>
                {publishing ? "Publishing…" : `Publish version ${nextVersionNumber}`}
              </button>
              <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={publishing}>
                Keep editing
              </button>
            </div>
            {publishError && (
              <div className="notice notice-error" role="alert">
                <span>{publishError.message}</span>
                {publishError.stale && (
                  <span>
                    <Link href={`/app/projects/${project.id}`}>Open the project to see the current version</Link>
                  </span>
                )}
              </div>
            )}
          </section>
        )}
      </aside>
    </div>
  );
}

function FeePreview({
  project,
  effort,
  fee,
  revisedDueOn,
}: {
  project: EditorProject;
  effort: number | null;
  fee: number | null;
  revisedDueOn: string;
}) {
  return (
    <table className="ledger">
      <caption className="visually-hidden">Fee preview in GBP</caption>
      <tbody>
        <tr>
          <td>Original fee</td>
          <td>{formatGBP(project.originalFeePence)}</td>
        </tr>
        <tr>
          <td>
            Additional fee
            <div className="muted small">
              {effort ? `${formatEffort(effort)} at ${formatGBP(project.ratePence)}/hour` : `at ${formatGBP(project.ratePence)}/hour`}
            </div>
          </td>
          <td>{fee === null ? "—" : `+ ${formatGBP(fee)}`}</td>
        </tr>
        <tr>
          <td>Revised due date</td>
          <td>{revisedDueOn ? formatDate(revisedDueOn) : "—"}</td>
        </tr>
        <tr className="total">
          <td>Revised total</td>
          <td>{fee === null ? "—" : formatGBP(revisedTotalPence(project.originalFeePence, fee))}</td>
        </tr>
      </tbody>
    </table>
  );
}
