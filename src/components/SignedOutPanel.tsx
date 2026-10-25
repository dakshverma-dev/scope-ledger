import { StartDemoButton } from "@/components/StartDemoButton";

export function SignedOutPanel() {
  return (
    <section className="card stack" style={{ maxWidth: 620 }}>
      <h1>Your workspace</h1>
      <p className="muted">
        This browser has no demo workspace yet. Starting the demo creates a private, anonymous workspace for this browser
        and loads the fictional Northlight Studio project.
      </p>
      <StartDemoButton label="Start the demo" />
    </section>
  );
}
