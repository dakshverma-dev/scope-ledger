"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Creates or resumes this browser's workspace, then opens the Northlight project. */
export function StartDemoButton({ label = "Try the demo" }: { label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/demo", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.projectId) {
        router.push(`/app/projects/${body.projectId}`);
        router.refresh();
        return;
      }
      if (body?.error?.code === "FREE_LIMIT_REACHED") {
        router.push("/app");
        return;
      }
      setError(body?.error?.message ?? "The demo could not start. Try again.");
    } catch {
      setError("Network error. Check your connection and try again.");
    }
    setBusy(false);
  }

  return (
    <div className="stack">
      <button type="button" className="btn btn-primary" onClick={start} disabled={busy} aria-busy={busy}>
        {busy ? "Opening workspace…" : label}
      </button>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
