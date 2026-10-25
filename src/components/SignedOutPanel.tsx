import { StartDemoButton } from "@/components/StartDemoButton";

export function SignedOutPanel() {
  return (
    <section className="card stack" style={{ maxWidth: 620 }}>
      <h1>Your workspace</h1>
      <p className="muted">
        This browser has no workspace yet. Starting the demo creates a private workspace for this browser (no account
        needed) and loads the fictional Northlight Studio project.
      </p>
      <StartDemoButton label="Start the demo" />
    </section>
  );
}
