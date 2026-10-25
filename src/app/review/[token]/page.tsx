import type { Metadata } from "next";
import { DecisionForm } from "@/components/DecisionForm";
import { BaselineList, FeeLedger, VersionStamp, VersionStatusBadge } from "@/components/ledger";
import { reviewRepository } from "@/lib/db/admin";
import { formatDate, formatTimestamp } from "@/lib/domain/money";
import type { ReviewSnapshot } from "@/lib/domain/types";
import { AppError } from "@/lib/http/errors";
import { getReview } from "@/lib/services/review";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Proposal review", robots: { index: false, follow: false } };

function Unavailable() {
  return (
    <div className="page page-narrow stack">
      <span className="status status-superseded" style={{ justifySelf: "start" }}>
        Link expired or superseded
      </span>
      <h1>This review link is unavailable</h1>
      <p className="muted">
        The link may have expired, been replaced by a newer proposal, or been typed incorrectly. Ask the consultant who
        sent it for the current link.
      </p>
    </div>
  );
}

export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let snap: ReviewSnapshot;
  try {
    snap = await getReview(reviewRepository(), token);
  } catch (err) {
    if (err instanceof AppError && err.code === "UNAVAILABLE") return <Unavailable />;
    throw err;
  }

  return (
    <div className="page stack-lg">
      <div className="stack">
        <p className="eyebrow">Proposal for {snap.clientName}</p>
        <div className="card-head" style={{ marginBottom: 0 }}>
          <div className="btn-row" style={{ gap: 14 }}>
            <VersionStamp n={snap.versionNumber} />
            <h1>{snap.projectName}</h1>
          </div>
          {snap.decision ? (
            <VersionStatusBadge status={snap.decision.decision} />
          ) : (
            <span className="status status-awaiting">Awaiting client decision</span>
          )}
        </div>
        <p className="muted small">
          Published {formatTimestamp(snap.publishedAt)}. This is a fixed copy: the consultant cannot change it without
          publishing a new version, which would replace this link.
        </p>
      </div>

      <div className="grid-main">
        <div className="stack-lg">
          <section className="card stack" aria-labelledby="orig-h">
            <h2 id="orig-h">Originally agreed</h2>
            <BaselineList items={snap.baselineItems} />
            <p className="muted small">Due {formatDate(snap.originalDueOn)}.</p>
          </section>

          <section className="card stack" aria-labelledby="change-h">
            <h2 id="change-h">Proposed additional work</h2>
            <ul className="baseline">
              {snap.approvedItems.map((item, i) => (
                <li key={i}>
                  <span className="mono small">#{i + 1}</span>
                  <span>
                    {item.description}
                    {item.baselineItemIds.length > 0 && (
                      <span className="muted small"> · relates to {item.baselineItemIds.join(", ")}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="sticky stack" aria-label="Price and decision">
          <section className="card stack">
            <span className="eyebrow">Price · version {snap.versionNumber}</span>
            <FeeLedger
              originalFeePence={snap.originalFeePence}
              ratePence={snap.ratePence}
              effortMinutes={snap.effortMinutes}
              extraFeePence={snap.extraFeePence}
              revisedTotalPence={snap.revisedTotalPence}
              revisedDueOn={snap.revisedDueOn}
              originalDueOn={snap.originalDueOn}
            />
          </section>

          {snap.decision ? (
            <section className="card stack" aria-labelledby="done-h">
              <h2 id="done-h">Decision recorded</h2>
              <VersionStatusBadge status={snap.decision.decision} />
              <p>
                Declared name: <strong>{snap.decision.declaredName}</strong>
              </p>
              {snap.decision.note && <p className="request-quote small">{snap.decision.note}</p>}
              <p className="muted small">Recorded {formatTimestamp(snap.decision.decidedAt)}.</p>
            </section>
          ) : (
            <DecisionForm token={token} versionNumber={snap.versionNumber} />
          )}
        </aside>
      </div>
    </div>
  );
}
