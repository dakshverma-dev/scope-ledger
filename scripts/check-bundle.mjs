// Scans the built browser assets (.next/static) for server secrets.
// Fails if a secret variable name, a configured secret value, or the Supabase
// client library appears in anything shipped to the browser.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.join(process.cwd(), ".next", "static");
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|css|html|json|map)$/.test(name)) files.push(p);
  }
})(root);

const needles = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "ANTHROPIC_API_KEY",
  "service_role",
  "record_review_decision",
  "get_review_snapshot",
  "@supabase/supabase-js",
  "signInAnonymously",
];
for (const name of ["SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]) {
  const v = process.env[name];
  if (v && v.length >= 16) needles.push(v);
}

let failures = 0;
for (const f of files) {
  const text = readFileSync(f, "utf8");
  for (const n of needles) {
    if (text.includes(n)) {
      failures++;
      const label = n.length > 40 || /^(sk-|sb_|ey)/.test(n) ? "<secret value>" : n;
      console.error(`FOUND ${label} in ${path.relative(process.cwd(), f)}`);
    }
  }
}
console.log(`Scanned ${files.length} browser asset files for ${needles.length} patterns.`);
if (failures) {
  console.error(`${failures} finding(s).`);
  process.exit(1);
}
console.log("No server secrets or privileged client code in browser assets.");
