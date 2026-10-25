"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LIMITS, type DecisionValue } from "@/lib/domain/validation";

/** Reviewer input only: decision, declared name, optional note. No price or date fields exist here. */
export function DecisionForm({ token, versionNumber }: { token: string; versionNumber: number }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<DecisionValue | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: DecisionValue) {
    if (!name.trim()) {
      setError("Enter your name to record a decision.");
      return;
    }
    setBusy(decision);
    setError(null);
    try {
      const res = await fetch(`/api/review/${encodeURIComponent(token)}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, declaredName: name, note: note.trim() ? note : null }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok) {
        router.refresh();
        return;
      }
      if (res.status === 409) {
        setError("A different decision has already been recorded for this version. Reload to see it.");
      } else {
        setError(body?.error?.message ?? "Your decision was not recorded. Try again.");
      }
    } catch {
      setError("Network error. Your decision was not recorded; try again.");
    }
    setBusy(null);
  }

  return (
    <section className="card stack" aria-labelledby="decide-h">
      <h2 id="decide-h">Your decision on version {versionNumber}</h2>
      <div className="field">
        <label htmlFor="reviewer-name">Your name</label>
        <input
          id="reviewer-name"
          className="input"
          maxLength={LIMITS.declaredNameMax}
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <span className="hint">Recorded as typed. It is not identity verification and not a signature.</span>
      </div>
      <div className="field">
        <label htmlFor="reviewer-note">Note (optional)</label>
        <textarea
          id="reviewer-note"
          className="textarea"
          style={{ minHeight: 88 }}
          maxLength={LIMITS.noteMax}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <span className="counter">
          {note.length} / {LIMITS.noteMax}
        </span>
      </div>
      <div className="btn-row">
        <button type="button" className="btn btn-primary" onClick={() => decide("accepted")} disabled={busy !== null} aria-busy={busy === "accepted"}>
          {busy === "accepted" ? "Recording…" : "Accept"}
        </button>
        <button type="button" className="btn" onClick={() => decide("revision_requested")} disabled={busy !== null} aria-busy={busy === "revision_requested"}>
          {busy === "revision_requested" ? "Recording…" : "Request revision"}
        </button>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <p className="hint">One decision can be recorded per version.</p>
    </section>
  );
}
