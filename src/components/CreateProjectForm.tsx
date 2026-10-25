"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { parsePoundsToPence } from "@/lib/domain/money";
import { createProjectSchema, describeIssues } from "@/lib/domain/validation";

interface Row {
  id: string;
  text: string;
}

/** Creates a project with a fixed baseline. The baseline cannot be edited afterwards. */
export function CreateProjectForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [fee, setFee] = useState("");
  const [rate, setRate] = useState("");
  const [due, setDue] = useState("");
  const [rows, setRows] = useState<Row[]>([{ id: "B1", text: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const originalFeePence = parsePoundsToPence(fee);
    const ratePence = parsePoundsToPence(rate);
    if (originalFeePence === null || ratePence === null) {
      setError("Enter the fee and hourly rate in pounds, for example 1800 or 90.00.");
      return;
    }
    const input = {
      name: name.trim(),
      clientName: client.trim(),
      baselineItems: rows.map((r) => ({ id: r.id, text: r.text.trim() })),
      originalFeePence,
      ratePence,
      dueOn: due,
    };
    const parsed = createProjectSchema.safeParse(input);
    if (!parsed.success) {
      setError(describeIssues(parsed.error));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.projectId) {
        router.push(`/app/projects/${body.projectId}`);
        return;
      }
      setError(body?.error?.message ?? "The project was not created.");
    } catch {
      setError("Network error. Nothing was created; try again.");
    }
    setBusy(false);
  }

  return (
    <form className="card stack" onSubmit={submit} noValidate aria-labelledby="new-project-h">
      <h2 id="new-project-h">Create your own project</h2>
      <p className="muted small">Uses your one free active project. The baseline is fixed once created.</p>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="p-name">Project name</label>
          <input id="p-name" className="input" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="p-client">Client name</label>
          <input id="p-client" className="input" maxLength={100} value={client} onChange={(e) => setClient(e.target.value)} required />
        </div>
      </div>
      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label">Agreed deliverables</legend>
        {rows.map((r, i) => (
          <div key={r.id} className="linkbox">
            <span className="tag" style={{ alignSelf: "center" }}>{r.id}</span>
            <input
              className="input"
              aria-label={`Deliverable ${r.id}`}
              maxLength={500}
              value={r.text}
              onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
            />
            {rows.length > 1 && (
              <button
                type="button"
                className="btn btn-danger-quiet"
                onClick={() => setRows(rows.filter((_, j) => j !== i).map((x, j) => ({ ...x, id: `B${j + 1}` })))}
              >
                Remove
              </button>
            )}
          </div>
        ))}
        {rows.length < 10 && (
          <button type="button" className="btn btn-quiet" style={{ justifySelf: "start" }} onClick={() => setRows([...rows, { id: `B${rows.length + 1}`, text: "" }])}>
            Add deliverable
          </button>
        )}
      </fieldset>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="p-fee">Original fee (£)</label>
          <input id="p-fee" className="input mono" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="p-rate">Hourly rate (£)</label>
          <input id="p-rate" className="input mono" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="p-due">Due date</label>
        <input id="p-due" className="input mono" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>
        {busy ? "Creating…" : "Create project"}
      </button>
    </form>
  );
}
