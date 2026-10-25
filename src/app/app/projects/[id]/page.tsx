import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BaselineFacts, BaselineList, VersionStamp, VersionStatusBadge } from "@/components/ledger";
import { orNotFound, pageSession } from "@/lib/auth/page";
import { formatDate, formatGBP, formatTimestamp } from "@/lib/domain/money";
import { getProjectOverview } from "@/lib/services/workspace";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Project", robots: { index: false } };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await pageSession();
  if (session.state !== "ok") redirect("/app");
  const { project, versions, current } = await orNotFound(() => getProjectOverview(session.repo, id));

  const newHref = current
    ? `/app/projects/${project.id}/changes/new?from=${current.version.id}`
    : `/app/projects/${project.id}/changes/new`;

  return (
    <div className="page stack-lg">
      <div className="stack">
        <p className="eyebrow">
          <Link href="/app">Workspace</Link> / {project.clientName}
          {project.isDemo && " · fictional demo"}
        </p>
        <div className="card-head" style={{ marginBottom: 0 }}>
          <h1>{project.name}</h1>
          <div className="btn-row">
            <Link href={`/app/projects/${project.id}/changes/new`} className="btn btn-primary">
              Start a new client request
            </Link>
            {current && (
              <Link href={newHref} className="btn">
                Revise version {current.version.versionNumber}
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="grid-main">
        <section className="card stack" aria-labelledby="baseline-h">
          <div className="card-head" style={{ marginBottom: 0 }}>
            <h2 id="baseline-h">Agreed baseline</h2>
            <span className="muted small">Fixed · cannot be edited</span>
          </div>
          <BaselineList items={project.baselineItems} />
          <BaselineFacts feePence={project.originalFeePence} ratePence={project.ratePence} dueOn={project.dueOn} />
        </section>

        <section className="card" aria-labelledby="versions-h">
          <div className="card-head">
            <h2 id="versions-h">Published versions</h2>
          </div>
          {versions.length === 0 ? (
            <p className="muted">
              Nothing published yet. Start a new client request to compare it with the baseline and publish version 1.
            </p>
          ) : (
            versions.map(({ version, status }) => (
              <div className="list-row" key={version.id}>
                <div className="stack" style={{ gap: 6 }}>
                  <div className="btn-row" style={{ gap: 8 }}>
                    <VersionStamp n={version.versionNumber} />
                    {version.id === project.currentVersionId && <span className="chip">Current</span>}
                  </div>
                  <span className="muted small">
                    + {formatGBP(version.extraFeePence)} · due {formatDate(version.revisedDueOn)} · published{" "}
                    {formatTimestamp(version.publishedAt)}
                  </span>
                </div>
                <div className="btn-row">
                  <VersionStatusBadge status={status} />
                  <Link href={`/app/changes/${version.id}`} className="btn">
                    Open
                  </Link>
                </div>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
