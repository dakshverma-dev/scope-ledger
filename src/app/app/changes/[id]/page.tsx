import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MarkedRequest } from "@/components/MarkedRequest";
import { ReviewLinkPanel } from "@/components/ReviewLinkPanel";
import { BaselineList, FeeLedger, VersionStamp, VersionStatusBadge } from "@/components/ledger";
import { orNotFound, pageSession } from "@/lib/auth/page";
import { formatTimestamp } from "@/lib/domain/money";
import { getVersionDetail } from "@/lib/services/workspace";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Published version", robots: { index: false } };

const CLASS_LABEL = { potential_addition: "Potential addition", clarification: "Clarification", unclear: "Unclear" } as const;

export default async function ChangePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ published?: string }>;
}) {
  const [{ id }, { published }] = await Promise.all([params, searchParams]);
  const session = await pageSession();
  if (session.state !== "ok") redirect("/app");
  const { project, entry, activeLink } = await orNotFound(() => getVersionDetail(session.repo, id));
  const { version: v, decision, status } = entry;
  const snap = v.baselineSnapshot;
  const isCurrent = project.currentVersionId === v.id;

  return (
    <div className="page stack-lg">
      <div className="stack">
        <p className="eyebrow">
          <Link href={`/app/projects/${project.id}`}>{snap.projectName}</Link> / Published version
        </p>
        <div className="card-head" style={{ marginBottom: 0 }}>
          <div className="btn-row" style={{ gap: 14 }}>
            <VersionStamp n={v.versionNumber} />
            <h1>{snap.projectName}</h1>
          </div>
          <VersionStatusBadge status={status} />
        </div>
        <p className="muted small">
          Published {formatTimestamp(v.publishedAt)} for {snap.clientName}. This version cannot be changed.
        </p>
        {published === "1" && (
          <div className="notice notice-ok" role="status">
            <strong>Version {v.versionNumber} published.</strong>
            <span>Copy the review link below and share it with your client yourself. Nothing has been emailed.</span>
          </div>
        )}
      </div>

      <div className="grid-main">
        <div className="stack-lg">
          <section className="card stack" aria-labelledby="changes-h">
            <h2 id="changes-h">Approved changes</h2>
            {v.approvedItems.map((item, i) => (
              <article className="item" key={item.id}>
                <div className="item-head">
                  <div className="btn-row" style={{ gap: 8 }}>
                    <span className="mono small">#{i + 1}</span>
                    <strong>{item.description}</strong>
                  </div>
                  <div className="btn-row" style={{ gap: 6 }}>
                    {item.baselineItemIds.map((b) => (
                      <span className="tag" key={b}>{b}</span>
                    ))}
                    {item.origin === "ai_suggested" ? (
                      <span className="chip chip-ai">AI suggested</span>
                    ) : (
                      <span className="chip chip-manual">Manually entered</span>
                    )}
                    {item.classification && <span className="chip">{CLASS_LABEL[item.classification]}</span>}
                  </div>
                </div>
                {item.sourceQuote && (
                  <blockquote className="quote">
                    <q>{item.sourceQuote}</q>
                  </blockquote>
                )}
              </article>
            ))}
          </section>

          <section className="card stack" aria-labelledby="request-h">
            <h2 id="request-h">Client request</h2>
            <MarkedRequest text={v.requestText} quotes={v.approvedItems.map((i) => i.sourceQuote)} />
          </section>

          <section className="card stack" aria-labelledby="baseline-h">
            <h2 id="baseline-h">Baseline at publication</h2>
            <BaselineList items={snap.baselineItems} />
          </section>
        </div>

        <aside className="sticky stack" aria-label="Terms and decision">
          <section className="card stack">
            <span className="eyebrow">Terms · version {v.versionNumber}</span>
            <FeeLedger
              originalFeePence={snap.originalFeePence}
              ratePence={snap.ratePence}
              effortMinutes={v.effortMinutes}
              extraFeePence={v.extraFeePence}
              revisedTotalPence={v.revisedTotalPence}
              revisedDueOn={v.revisedDueOn}
              originalDueOn={snap.dueOn}
            />
          </section>

          <section className="card stack" aria-labelledby="decision-h">
            <h2 id="decision-h">Client decision</h2>
            {decision ? (
              <div className="stack">
                <VersionStatusBadge status={decision.decision} />
                <p>
                  Declared name: <strong>{decision.declaredName}</strong>
                </p>
                {decision.note && <p className="request-quote small">{decision.note}</p>}
                <p className="muted small">Recorded {formatTimestamp(decision.decidedAt)}. The name is self-declared, not verified.</p>
              </div>
            ) : isCurrent ? (
              <p className="muted">
                <span className="status status-awaiting">Awaiting client decision</span>
              </p>
            ) : (
              <p className="muted">Superseded by a later version before any decision. Its link no longer works.</p>
            )}
          </section>

          {isCurrent && (
            <ReviewLinkPanel
              projectId={project.id}
              versionId={v.id}
              linkExpiresAt={activeLink?.expiresAt ?? null}
              reissuePayload={{
                publishKey: v.publishKey,
                expectedCurrentVersionId: v.id,
                requestText: v.requestText,
                approvedItems: v.approvedItems,
                effortMinutes: v.effortMinutes,
                revisedDueOn: v.revisedDueOn,
                confirmed: true,
              }}
            />
          )}

          <section className="card stack no-print" aria-labelledby="record-h">
            <h2 id="record-h">Record</h2>
            <div className="btn-row">
              <a className="btn" href={`/api/changes/${v.id}/export?format=html`} target="_blank" rel="noopener">
                Export record (HTML)
              </a>
              <a className="btn" href={`/api/changes/${v.id}/export?format=json`}>
                Download JSON
              </a>
            </div>
            <Link href={`/app/projects/${project.id}/changes/new?from=${v.id}`} className="btn btn-quiet" style={{ justifySelf: "start", paddingLeft: 0 }}>
              Create revised version
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
