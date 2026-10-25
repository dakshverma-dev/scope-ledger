import { formatDate, formatEffort, formatGBP } from "@/lib/domain/money";
import type { BaselineItem, VersionStatus } from "@/lib/domain/types";

const STATUS_LABEL: Record<VersionStatus, { label: string; cls: string }> = {
  awaiting_decision: { label: "Awaiting client decision", cls: "status-awaiting" },
  accepted: { label: "Accepted", cls: "status-accepted" },
  revision_requested: { label: "Revision requested", cls: "status-revision" },
  superseded: { label: "Superseded", cls: "status-superseded" },
};

export function VersionStatusBadge({ status }: { status: VersionStatus }) {
  const s = STATUS_LABEL[status];
  return <span className={`status ${s.cls}`}>{s.label}</span>;
}

export function VersionStamp({ n }: { n: number }) {
  return (
    <span className="version-stamp" aria-label={`Version ${n}`}>
      <span>Version</span>
      <b>{n}</b>
    </span>
  );
}

export function BaselineList({ items }: { items: BaselineItem[] }) {
  return (
    <ul className="baseline">
      {items.map((b) => (
        <li key={b.id}>
          <span className="tag">{b.id}</span>
          <span>{b.text}</span>
        </li>
      ))}
    </ul>
  );
}

export function BaselineFacts({ feePence, ratePence, dueOn }: { feePence: number; ratePence: number; dueOn: string }) {
  return (
    <dl className="facts">
      <div>
        <dt>Original fee</dt>
        <dd>{formatGBP(feePence)}</dd>
      </div>
      <div>
        <dt>Hourly rate</dt>
        <dd>{formatGBP(ratePence)}</dd>
      </div>
      <div>
        <dt>Original due date</dt>
        <dd>{formatDate(dueOn)}</dd>
      </div>
    </dl>
  );
}

export function FeeLedger(props: {
  originalFeePence: number;
  ratePence: number;
  effortMinutes: number;
  extraFeePence: number;
  revisedTotalPence: number;
  revisedDueOn: string;
  originalDueOn: string;
}) {
  return (
    <table className="ledger">
      <caption className="visually-hidden">Fee summary in GBP</caption>
      <tbody>
        <tr>
          <td>Original fee</td>
          <td>{formatGBP(props.originalFeePence)}</td>
        </tr>
        <tr>
          <td>
            Additional fee
            <div className="muted small">
              {formatEffort(props.effortMinutes)} at {formatGBP(props.ratePence)}/hour
            </div>
          </td>
          <td>+ {formatGBP(props.extraFeePence)}</td>
        </tr>
        <tr>
          <td>
            Due date
            <div className="muted small">was {formatDate(props.originalDueOn)}</div>
          </td>
          <td>{formatDate(props.revisedDueOn)}</td>
        </tr>
        <tr className="total">
          <td>Revised total</td>
          <td>{formatGBP(props.revisedTotalPence)}</td>
        </tr>
      </tbody>
    </table>
  );
}

export function ConfigNotice({ what }: { what: string }) {
  return (
    <div className="notice notice-warn" role="status">
      <strong>{what} is not configured on this deployment.</strong>
      <span>
        Set the environment variables listed in <span className="mono">.env.example</span> and apply the Supabase
        migrations. See the README for setup steps.
      </span>
    </div>
  );
}
