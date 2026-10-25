import type { Metadata } from "next";
import Link from "next/link";
import { ConfigNotice, VersionStamp, VersionStatusBadge } from "@/components/ledger";
import { CreateProjectForm } from "@/components/CreateProjectForm";
import { SignedOutPanel } from "@/components/SignedOutPanel";
import { StartDemoButton } from "@/components/StartDemoButton";
import { pageSession } from "@/lib/auth/page";
import { formatDate, formatGBP } from "@/lib/domain/money";
import { getProjectOverview } from "@/lib/services/workspace";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Workspace", robots: { index: false } };

export default async function WorkspacePage() {
  const session = await pageSession();
  if (session.state === "unconfigured") {
    return (
      <div className="page">
        <ConfigNotice what="Supabase" />
      </div>
    );
  }
  if (session.state === "signed_out") {
    return (
      <div className="page">
        <SignedOutPanel />
      </div>
    );
  }

  const projects = await session.repo.listProjects();
  const overviews = await Promise.all(projects.map((p) => getProjectOverview(session.repo, p.id)));
  const active = projects.filter((p) => !p.archivedAt);
  const atLimit = active.length >= 1;

  return (
    <div className="page stack-lg">
      <div className="stack">
        <p className="eyebrow">Private workspace · this browser only</p>
        <h1>Your projects</h1>
      </div>

      {overviews.length > 0 && (
        <section className="card" aria-label="Projects">
          {overviews.map(({ project, current }) => (
            <div className="list-row" key={project.id}>
              <div className="stack" style={{ gap: 4 }}>
                <h2 style={{ fontSize: "1.15rem" }}>{project.name}</h2>
                <p className="muted small">
                  {project.clientName} · {formatGBP(project.originalFeePence)} · due {formatDate(project.dueOn)}
                  {project.isDemo && " · fictional demo"}
                </p>
              </div>
              <div className="btn-row">
                {current ? (
                  <>
                    <VersionStamp n={current.version.versionNumber} />
                    <VersionStatusBadge status={current.status} />
                  </>
                ) : (
                  <span className="status status-draft">No published version</span>
                )}
                <Link href={`/app/projects/${project.id}`} className="btn btn-primary">
                  Continue project
                </Link>
              </div>
            </div>
          ))}
        </section>
      )}

      {atLimit ? (
        <section className="card stack" aria-labelledby="allowance-h">
          <h2 id="allowance-h">Free allowance reached</h2>
          <p className="muted">
            The free workspace includes one active project, and it is in use. The proposed Solo plan (£12/month, up to ten
            active projects) is not available yet. Payments are not collected in this demo.
          </p>
          <div className="btn-row">
            <Link href={`/app/projects/${active[0].id}`} className="btn btn-primary">
              Continue project
            </Link>
            <Link href="/pricing" className="btn">
              See the proposed plan
            </Link>
            <button type="button" className="btn" disabled aria-disabled="true">
              Coming later
            </button>
          </div>
        </section>
      ) : (
        <div className="grid-2">
          <section className="card stack">
            <h2>Load the fictional demo</h2>
            <p className="muted">Northlight Studio: a three-page website with one revision round, due 9 Nov 2026.</p>
            <StartDemoButton label="Load Northlight demo" />
          </section>
          <CreateProjectForm />
        </div>
      )}
    </div>
  );
}
