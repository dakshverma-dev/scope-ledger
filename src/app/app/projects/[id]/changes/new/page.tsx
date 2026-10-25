import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChangeEditor, type EditorSource } from "@/components/ChangeEditor";
import { orNotFound, pageSession } from "@/lib/auth/page";
import { getProjectOverview } from "@/lib/services/workspace";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New client request", robots: { index: false } };

export default async function NewChangePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const [{ id }, { from }] = await Promise.all([params, searchParams]);
  const session = await pageSession();
  if (session.state !== "ok") redirect("/app");
  const { project, versions } = await orNotFound(() => getProjectOverview(session.repo, id));

  // Revising copies an earlier published version of this same project into a new draft.
  const sourceVersion = from ? versions.find((v) => v.version.id === from)?.version : undefined;
  const source: EditorSource | null = sourceVersion
    ? {
        versionId: sourceVersion.id,
        versionNumber: sourceVersion.versionNumber,
        requestText: sourceVersion.requestText,
        approvedItems: sourceVersion.approvedItems,
        effortMinutes: sourceVersion.effortMinutes,
        revisedDueOn: sourceVersion.revisedDueOn,
      }
    : null;
  const latest = versions[0]?.version.versionNumber ?? 0;

  return (
    <div className="page stack-lg">
      <div className="stack">
        <p className="eyebrow">
          <Link href={`/app/projects/${project.id}`}>{project.name}</Link> / {source ? "Revised version" : "New client request"}
        </p>
        <h1>{source ? `Revise version ${source.versionNumber}` : "Compare a new request"}</h1>
      </div>
      <ChangeEditor
        project={{
          id: project.id,
          name: project.name,
          clientName: project.clientName,
          baselineItems: project.baselineItems,
          originalFeePence: project.originalFeePence,
          ratePence: project.ratePence,
          dueOn: project.dueOn,
        }}
        currentVersionId={project.currentVersionId}
        nextVersionNumber={latest + 1}
        source={source}
      />
    </div>
  );
}
