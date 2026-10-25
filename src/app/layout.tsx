import type { Metadata } from "next";
import { Bricolage_Grotesque, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage", weight: ["600", "700"] });
const body = IBM_Plex_Sans({ subsets: ["latin"], variable: "--font-plex-sans", weight: ["400", "500", "600", "700"] });
const mono = IBM_Plex_Mono({ subsets: ["latin"], variable: "--font-plex-mono", weight: ["400", "600"] });

export const metadata: Metadata = {
  title: { default: "Scope Ledger", template: "%s · Scope Ledger" },
  description: "Keep client scope changes attached to an approved version and price.",
};

function LedgerMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <rect x="1" y="1" width="20" height="20" rx="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5 8h12M5 12h8M5 16h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="16.5" cy="12" r="1.6" fill="#1d4ed8" />
    </svg>
  );
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/" className="wordmark">
              <LedgerMark />
              Scope Ledger
            </Link>
            <nav className="nav" aria-label="Main">
              <Link href="/app">Workspace</Link>
              <Link href="/pricing">Pricing</Link>
            </nav>
          </div>
        </header>
        <main id="main">{children}</main>
        <footer className="footer">
          <div className="footer-inner">
            <span>Illustrative prototype with fictional client data.</span>
            <span>Not a contract, e-signature or payment service.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
