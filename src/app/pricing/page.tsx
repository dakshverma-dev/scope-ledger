import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Pricing" };

export default function PricingPage() {
  return (
    <div className="page page-narrow stack-lg">
      <div className="stack">
        <p className="eyebrow">Commercial hypothesis</p>
        <h1>Pricing</h1>
        <div className="notice notice-warn" role="note">
          <strong>Payments are not collected in this demo.</strong>
          <span>The paid plan below is a proposal. There is no checkout, subscription or upgrade.</span>
        </div>
      </div>

      <div className="grid-2">
        <section className="card plan" aria-labelledby="free-plan">
          <p className="eyebrow">Free trial</p>
          <h2 id="free-plan">Free</h2>
          <p className="price">£0</p>
          <ul className="muted" style={{ margin: 0, paddingLeft: 18 }}>
            <li>One active project</li>
            <li>Versioned proposals and review links</li>
            <li>20 AI analyses per day</li>
          </ul>
          <Link href="/app" className="btn">
            Continue project
          </Link>
        </section>

        <section className="card plan" aria-labelledby="solo-plan">
          <p className="eyebrow">Proposed plan</p>
          <h2 id="solo-plan">Solo</h2>
          <p className="price">
            £12<span className="muted" style={{ fontSize: "1rem", fontWeight: 500 }}> / month</span>
          </p>
          <ul className="muted" style={{ margin: 0, paddingLeft: 18 }}>
            <li>Up to ten active projects</li>
            <li>Everything in the free trial</li>
          </ul>
          <button type="button" className="btn" disabled aria-disabled="true">
            Coming later
          </button>
        </section>
      </div>

      <section className="stack">
        <h2>How the numbers are estimated</h2>
        <p className="muted">
          An illustrative cost model, not a measured margin: 20 analysed changes per paid account per month at an assumed
          £0.05 each is £1.00 of AI cost, leaving £11.00 before hosting, support, payment fees and acquisition. The £0.05
          figure is a hypothesis until real usage is measured.
        </p>
      </section>
    </div>
  );
}
