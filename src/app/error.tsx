"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="page page-narrow stack">
      <h1>Something went wrong</h1>
      <p className="muted">The page could not load. Nothing was published or changed. Any unsent draft is still saved in this browser.</p>
      <button type="button" className="btn" style={{ justifySelf: "start" }} onClick={reset}>
        Try again
      </button>
    </div>
  );
}
