import Link from "next/link";
import { StartDemoButton } from "@/components/StartDemoButton";

export default function Home() {
  return (
    <div className="page">
      <section className="hero">
        <div>
          <p className="eyebrow">For solo consultants on fixed-scope work</p>
          <h1 style={{ marginTop: 14 }}>Keep client scope changes attached to an approved version and price.</h1>
          <p className="hero-lede">
            Scope Ledger compares a client&apos;s new request with the deliverables you already agreed, quoting the exact
            words that point to extra work. You set the hours and date, publish one fixed version, and your client
            accepts or asks for a revision through a private link.
          </p>
          <div className="btn-row" style={{ marginTop: 28 }}>
            <StartDemoButton />
            <Link href="/pricing" className="btn">
              Pricing
            </Link>
          </div>
          <p className="notice" style={{ marginTop: 24, maxWidth: 520 }}>
            The demo uses fictional client work (Northlight Studio). No real clients, payments or signatures are involved.
          </p>
        </div>

        <figure className="specimen" aria-label="Example ledger entry from the fictional demo" style={{ margin: 0 }}>
          <div className="card-head" style={{ marginBottom: 8 }}>
            <span className="eyebrow">Northlight website refresh</span>
            <span className="version-stamp" aria-hidden="true">
              <span>Version</span>
              <b>1</b>
            </span>
          </div>
          <div className="row">
            <span className="tag">B1</span>
            <span>Design and implement a three page responsive website</span>
            <span />
          </div>
          <div className="row">
            <span className="tag">B2</span>
            <span>Include one round of revisions</span>
            <span />
          </div>
          <p className="request-quote" style={{ margin: "14px 0" }}>
            Please <mark className="evidence">add two service pages<sup>B1</sup></mark> and{" "}
            <mark className="evidence">a second round of revisions<sup>B2</sup></mark>.
          </p>
          <table className="ledger">
            <tbody>
              <tr>
                <td>Additional fee · 1 h 30 min at £90.00/hour</td>
                <td>+ £135.00</td>
              </tr>
              <tr className="total">
                <td>Revised total</td>
                <td>£1,935.00</td>
              </tr>
            </tbody>
          </table>
          <figcaption className="muted small" style={{ marginTop: 12 }}>
            <span className="status status-accepted">Accepted</span>{" "}
            <span style={{ marginLeft: 6 }}>by the declared reviewer, recorded against version 1.</span>
          </figcaption>
        </figure>
      </section>
    </div>
  );
}
