"use client";

import { useEffect, useState } from "react";
import { recallReviewUrl, rememberReviewUrl } from "@/lib/client/draft";
import { formatTimestamp } from "@/lib/domain/money";
import type { PublishInput } from "@/lib/domain/validation";

interface Props {
  projectId: string;
  versionId: string;
  linkExpiresAt: string | null;
  /** The version's own publish payload: re-sending its key rotates the link without a new version. */
  reissuePayload: PublishInput;
}

export function ReviewLinkPanel({ projectId, versionId, linkExpiresAt, reissuePayload }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [expires, setExpires] = useState(linkExpiresAt);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Read the one-time link after hydration; sessionStorage is not available on the server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (linkExpiresAt) setUrl(recallReviewUrl(versionId));
  }, [versionId, linkExpiresAt]);

  async function reissue() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reissuePayload),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.reviewUrl && body.versionId === versionId) {
        rememberReviewUrl(versionId, body.reviewUrl);
        setUrl(body.reviewUrl);
        setExpires(body.linkExpiresAt);
      } else {
        setError(body?.error?.message ?? "No new link was issued.");
      }
    } catch {
      setError("Network error. No new link was issued.");
    }
    setBusy(false);
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="card stack no-print" aria-labelledby="link-h">
      <h2 id="link-h">Client review link</h2>
      {url && expires ? (
        <>
          <div className="linkbox">
            <input className="input" readOnly value={url} aria-label="Review link" onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="btn" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="hint">
            Anyone with this link can view this version and record a decision. Expires {formatTimestamp(expires)}.
          </p>
        </>
      ) : expires ? (
        <p className="muted small">
          A link is active until {formatTimestamp(expires)}. For security the full link is only shown when it is issued.
        </p>
      ) : (
        <p className="muted small">No active link. Issue one to share this version.</p>
      )}
      <button type="button" className="btn btn-quiet" style={{ justifySelf: "start", paddingLeft: 0 }} onClick={reissue} disabled={busy}>
        {busy ? "Issuing…" : expires ? "Issue a new link (the old one stops working)" : "Issue a review link"}
      </button>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
