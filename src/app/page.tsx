import Image from "next/image";
import Link from "next/link";
import { Reveal } from "@/components/landing/Reveal";
import { StartDemoButton } from "@/components/StartDemoButton";
import { VersionStamp, VersionStatusBadge } from "@/components/ledger";
import compareShot from "../../public/screens/compare.png";
import priceShot from "../../public/screens/price.png";
import reviewShot from "../../public/screens/review-mobile.png";
import supersededShot from "../../public/screens/superseded-mobile.png";
import versionShot from "../../public/screens/version.png";
import s from "./landing.module.css";

const STEPS = [
  {
    id: "compare",
    verb: "Compare",
    title: "See exactly what the client is asking for",
    body: "Paste the request as written. Each change is matched to an agreed deliverable and backed by the client's own words.",
    image: compareShot,
    alt: "The client request with the phrases “add two service pages” and “a second round of revisions” highlighted as evidence.",
    phone: false,
  },
  {
    id: "price",
    verb: "Price",
    title: "Set the time, and the fee follows",
    body: "You decide the extra time and the new due date. The fee comes from your agreed rate: 90 minutes at £90 an hour is £135.00.",
    image: priceShot,
    alt: "Fee preview: original fee £1,800.00, additional fee £135.00, revised total £1,935.00, marked Ready to publish.",
    phone: false,
    narrow: true,
  },
  {
    id: "publish",
    verb: "Publish",
    title: "Freeze it as a numbered version",
    body: "Publishing locks the proposal as version 1 and gives you a private link to send. Nothing is emailed on your behalf.",
    image: versionShot,
    alt: "Version 1 of the Northlight website refresh with approved changes, terms totalling £1,935.00 and an Accepted decision.",
    phone: false,
    fade: true,
  },
  {
    id: "decide",
    verb: "Decide",
    title: "Your client answers in one place",
    body: "The client opens the link without an account, reads exactly what changed, and accepts or asks for a revision.",
    image: reviewShot,
    alt: "The client review page on a phone, showing the originally agreed work and the proposed additional work.",
    phone: true,
  },
];

export default function Home() {
  return (
    <div className={s.landing}>
      {/* Hero */}
      <section className={s.hero}>
        <div className={s.heroCopy}>
          <p className="eyebrow">For solo consultants on fixed-scope work</p>
          <h1 className={s.heroTitle}>Every extra request, priced and approved.</h1>
          <p className={s.heroLede}>
            Compare new requests with the agreed scope, price the extra work, and get a clear yes on one fixed version.
          </p>
          <div className={s.heroActions}>
            <StartDemoButton />
            <a href="#how" className="btn">
              See how it works
            </a>
          </div>
        </div>
        <div className={s.heroVisual}>
          <div className={`${s.frame} ${s.heroMain} ${s.fadeBottom}`}>
            <Image src={versionShot} alt="A published, accepted version of a scope change with its fee and decision." priority sizes="(max-width: 880px) 100vw, 620px" />
          </div>
          <div className={`${s.frame} ${s.phone} ${s.heroPhone}`}>
            <Image src={reviewShot} alt="The same proposal as the client sees it on a phone." sizes="200px" />
          </div>
        </div>
      </section>

      <p className={s.fiction}>
        The demo uses fictional client work (Northlight Studio). No real clients, payments or signatures are involved.
      </p>

      {/* Problem */}
      <section className={s.problem} aria-labelledby="problem-h">
        <Reveal className={s.problemQuote}>
          <h2 id="problem-h" className={s.sectionTitle}>
            The project was agreed. Then the client asked for more.
          </h2>
          <blockquote className={s.bigQuote}>
            <p>“Please add two service pages and a second round of revisions.”</p>
            <footer>Northlight Studio, halfway through a £1,800 website</footer>
          </blockquote>
        </Reveal>
        <div className={s.problemList}>
          {[
            ["What did we actually agree?", "The original deliverables sit in an old proposal or a chat thread nobody rereads."],
            ["What should the extra cost?", "Prices get decided in a hurry, or the work quietly gets done for free."],
            ["Did they say yes to this?", "Approval is a reply in an email chain, not tied to a fixed scope or amount."],
          ].map(([q, a], i) => (
            <Reveal key={q} delay={i * 80} className={s.problemItem}>
              <h3>{q}</h3>
              <p>{a}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className={s.how} aria-labelledby="how-h">
        <div className={s.howRail}>
          <h2 id="how-h" className={s.sectionTitle}>
            How it works
          </h2>
          <p className={s.howIntro}>
            Scope Ledger keeps your agreed deliverables, fee and hourly rate on file. When a client asks for more, it turns
            the request into one fixed, priced version they can accept or send back.
          </p>
          <ol className={s.railList}>
            {STEPS.map((step) => (
              <li key={step.id}>
                <a href={`#step-${step.id}`}>{step.verb}</a>
              </li>
            ))}
          </ol>
        </div>
        <div className={s.howSteps}>
          {STEPS.map((step) => (
            <Reveal key={step.id} className={s.step}>
              <article id={`step-${step.id}`} aria-labelledby={`step-${step.id}-h`}>
                <p className={s.stepVerb}>{step.verb}</p>
                <h3 id={`step-${step.id}-h`} className={s.stepTitle}>
                  {step.title}
                </h3>
                <p className={s.stepBody}>{step.body}</p>
                <div
                  className={
                    step.phone
                      ? `${s.frame} ${s.phone} ${s.stepPhone}`
                      : `${s.frame} ${s.stepShot} ${"narrow" in step ? s.stepNarrow : ""} ${"fade" in step ? s.fadeBottom : ""}`
                  }
                >
                  <Image src={step.image} alt={step.alt} sizes={step.phone ? "260px" : "(max-width: 880px) 100vw, 640px"} />
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Guarantees */}
      <section className={s.record} aria-labelledby="record-h">
        <h2 id="record-h" className={s.sectionTitle}>
          A record you can point back to.
        </h2>
        <div className={s.bento}>
          <Reveal className={`${s.cell} ${s.cellVersions}`}>
            <h3>New version, same history</h3>
            <p>Publishing version 2 never touches version 1. Its price, its scope and the client&apos;s decision stay exactly as accepted.</p>
            <div className={s.versionRows} aria-label="Example version history">
              <div className={s.versionRow}>
                <VersionStamp n={2} />
                <span className="mono">+ £180.00</span>
                <VersionStatusBadge status="awaiting_decision" />
              </div>
              <div className={s.versionRow}>
                <VersionStamp n={1} />
                <span className="mono">+ £135.00</span>
                <VersionStatusBadge status="accepted" />
              </div>
            </div>
          </Reveal>
          <Reveal className={`${s.cell} ${s.cellFee}`} delay={80}>
            <p className={s.feeFigure}>£135.00</p>
            <p className={s.feeSum}>90 min × £90.00/hour</p>
            <h3>The fee is arithmetic</h3>
            <p>Calculated from your stored rate when you publish. Nobody types a price, including the client.</p>
          </Reveal>
          <Reveal className={`${s.cell} ${s.cellQuote}`} delay={40}>
            <p className={s.quoteSample}>
              Please <mark className="evidence">add two service pages</mark> and…
            </p>
            <h3>Quotes, not paraphrases</h3>
            <p>Suggested changes must quote words that really appear in the request. Anything else is thrown out.</p>
          </Reveal>
          <Reveal className={`${s.cell} ${s.cellLinks}`} delay={120}>
            <div className={s.linksCopy}>
              <h3>Old links stop working</h3>
              <p>A newer version or a fresh link retires the old one. A dead link shows nothing about the project.</p>
            </div>
            <div className={`${s.frame} ${s.phone} ${s.linksPhone}`}>
              <Image src={supersededShot} alt="A superseded review link showing only that the link is unavailable." sizes="180px" />
            </div>
          </Reveal>
        </div>
      </section>

      {/* Honesty + pricing */}
      <section className={s.honest} aria-labelledby="honest-h">
        <Reveal className={s.honestCopy}>
          <h2 id="honest-h" className={s.sectionTitle}>
            Clear about what it is.
          </h2>
          <p className={s.honestLede}>
            Scope Ledger records a decision against a fixed version. A client&apos;s typed name is kept as given; it is a clear
            record, not legal paperwork.
          </p>
          <ul className={s.notList}>
            <li>Not a contract</li>
            <li>Not an e-signature</li>
            <li>Does not take payments</li>
            <li>Does not email anyone</li>
          </ul>
        </Reveal>
        <Reveal className={s.priceCard} delay={80}>
          <h3>Free for one active project</h3>
          <p>
            A Solo plan at £12 a month for up to ten projects is proposed, not on sale yet. Payments are not collected in
            this demo.
          </p>
          <Link href="/pricing" className={s.textLink}>
            See pricing
          </Link>
        </Reveal>
      </section>

      {/* Closing */}
      <section className={s.closing} aria-labelledby="closing-h">
        <h2 id="closing-h" className={s.closingTitle}>
          Walk through the Northlight example.
        </h2>
        <p>A fictional client, the real workflow, about two minutes.</p>
        <StartDemoButton />
      </section>
    </div>
  );
}
