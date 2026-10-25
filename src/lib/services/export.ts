import type { OwnerRepository } from "@/lib/db/repository";
import { formatDate, formatEffort, formatGBP, formatTimestamp } from "@/lib/domain/money";
import { getVersionDetail } from "./workspace";

export const EXPORT_FORMAT = "scope-ledger.version-record/1";

/** The exact persisted version and decision, with no tokens, keys or owner IDs. */
export async function buildExportRecord(repo: OwnerRepository, versionId: string, now = new Date()) {
  const { project, entry } = await getVersionDetail(repo, versionId);
  const v = entry.version;
  return {
    format: EXPORT_FORMAT,
    exportedAt: now.toISOString(),
    currency: "GBP" as const,
    amountsIn: "integer pence" as const,
    project: { name: v.baselineSnapshot.projectName, clientName: v.baselineSnapshot.clientName },
    status: entry.status,
    isCurrentVersion: project.currentVersionId === v.id,
    version: {
      versionNumber: v.versionNumber,
      publishedAt: v.publishedAt,
      baselineSnapshot: v.baselineSnapshot,
      requestText: v.requestText,
      approvedItems: v.approvedItems,
      effortMinutes: v.effortMinutes,
      extraFeePence: v.extraFeePence,
      revisedTotalPence: v.revisedTotalPence,
      revisedDueOn: v.revisedDueOn,
    },
    decision: entry.decision
      ? {
          decision: entry.decision.decision,
          declaredName: entry.decision.declaredName,
          note: entry.decision.note,
          decidedAt: entry.decision.decidedAt,
        }
      : null,
    disclaimer:
      "In-product workflow record. The declared name is self-reported and not identity verification; this is not an e-signature or a legal contract.",
  };
}
export type ExportRecord = Awaited<ReturnType<typeof buildExportRecord>>;

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Every piece of user-supplied text passes through this before reaching HTML. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

const STATUS_TEXT = {
  awaiting_decision: "Awaiting client decision",
  accepted: "Accepted",
  revision_requested: "Revision requested",
  superseded: "Superseded",
} as const;

export function renderExportHtml(r: ExportRecord): string {
  const e = escapeHtml;
  const v = r.version;
  const s = v.baselineSnapshot;
  const baseline = s.baselineItems.map((b) => `<tr><td class="id">${e(b.id)}</td><td>${e(b.text)}</td></tr>`).join("");
  const items = v.approvedItems
    .map(
      (i, n) =>
        `<tr><td class="id">${n + 1}</td><td>${e(i.description)}${i.sourceQuote ? `<div class="q">“${e(i.sourceQuote)}”</div>` : ""}</td><td>${e(i.baselineItemIds.join(", ") || "—")}</td><td>${i.origin === "ai_suggested" ? "AI suggested, consultant approved" : "Manually entered"}</td></tr>`,
    )
    .join("");
  const decision = r.decision
    ? `<p><strong>${e(STATUS_TEXT[r.decision.decision])}</strong> by declared name <strong>${e(r.decision.declaredName)}</strong> at ${e(formatTimestamp(r.decision.decidedAt))} (${e(r.decision.decidedAt)}).</p>${r.decision.note ? `<p class="q">${e(r.decision.note)}</p>` : ""}`
    : `<p><strong>${e(STATUS_TEXT[r.status])}</strong>. No client decision recorded.</p>`;

  return `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${e(s.projectName)} · version ${v.versionNumber} record</title>
<style>
body{font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;color:#151a22;background:#fff;max-width:820px;margin:0 auto;padding:32px 20px}
h1{font-size:1.6rem;margin:0 0 4px}h2{font-size:1.05rem;margin:28px 0 8px;border-bottom:1px solid #e2e5ea;padding-bottom:6px}
table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:7px 8px 7px 0;border-bottom:1px solid #e2e5ea;vertical-align:top}
.id{font-family:ui-monospace,monospace;width:44px}.num{text-align:right;font-family:ui-monospace,monospace;white-space:nowrap}
.total td{font-weight:700;border-top:2px solid #151a22}.q{color:#586172;font-style:italic;white-space:pre-wrap}.muted{color:#586172;font-size:.88rem}
.req{white-space:pre-wrap;background:#f6f7f9;padding:12px 14px;border-radius:6px}
</style></head><body>
<p class="muted">Scope Ledger · version record · exported ${e(r.exportedAt)}</p>
<h1>${e(s.projectName)} — version ${v.versionNumber}</h1>
<p>Client: ${e(s.clientName)} · Published ${e(formatTimestamp(v.publishedAt))} (${e(v.publishedAt)})</p>
<h2>Decision</h2>${decision}
<h2>Original baseline</h2><table>${baseline}</table>
<p>Original fee ${e(formatGBP(s.originalFeePence))} · Hourly rate ${e(formatGBP(s.ratePence))} · Original due date ${e(formatDate(s.dueOn))}</p>
<h2>Approved changes</h2><table><tr><th>#</th><th>Change</th><th>Baseline</th><th>Source</th></tr>${items}</table>
<h2>Client request (as received)</h2><p class="req">${e(v.requestText)}</p>
<h2>Terms</h2><table>
<tr><td>Original fee</td><td class="num">${e(formatGBP(s.originalFeePence))}</td></tr>
<tr><td>Additional fee (${e(formatEffort(v.effortMinutes))} at ${e(formatGBP(s.ratePence))}/hour)</td><td class="num">${e(formatGBP(v.extraFeePence))}</td></tr>
<tr><td>Revised due date</td><td class="num">${e(formatDate(v.revisedDueOn))}</td></tr>
<tr class="total"><td>Revised total</td><td class="num">${e(formatGBP(v.revisedTotalPence))}</td></tr>
</table>
<p class="muted">${e(r.disclaimer)}</p>
</body></html>`;
}

export function exportFileName(r: ExportRecord): string {
  const slug = r.project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "project";
  return `scope-ledger-${slug}-v${r.version.versionNumber}.json`;
}
