import Link from "next/link";

export default function NotFound() {
  return (
    <div className="page page-narrow stack">
      <h1>Not available</h1>
      <p className="muted">This page does not exist, or it belongs to a different workspace.</p>
      <Link href="/app" className="btn" style={{ justifySelf: "start" }}>
        Go to your workspace
      </Link>
    </div>
  );
}
