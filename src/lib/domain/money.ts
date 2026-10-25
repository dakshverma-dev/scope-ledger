import { LIMITS } from "./validation";

/**
 * Exact specification formula: half-up rounding to the nearest penny using
 * integer arithmetic. The database computes the same value authoritatively.
 */
export function extraFeePence(ratePence: number, effortMinutes: number): number {
  if (!Number.isSafeInteger(ratePence) || ratePence < 1 || ratePence > LIMITS.rateMaxPence) {
    throw new RangeError("ratePence out of range");
  }
  if (!Number.isSafeInteger(effortMinutes) || effortMinutes < 0 || effortMinutes > LIMITS.effortMax) {
    throw new RangeError("effortMinutes out of range");
  }
  const product = ratePence * effortMinutes + 30;
  if (!Number.isSafeInteger(product)) throw new RangeError("Fee overflow");
  return Math.floor(product / 60);
}

export function revisedTotalPence(originalFeePence: number, extra: number): number {
  const total = originalFeePence + extra;
  if (!Number.isSafeInteger(total)) throw new RangeError("Total overflow");
  return total;
}

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2 });

/** e.g. 193500 -> "£1,935.00" */
export function formatGBP(pence: number): string {
  return gbp.format(pence / 100);
}

/** e.g. 90 -> "1 h 30 min" */
export function formatEffort(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** "2026-11-11" -> "Wed 11 Nov 2026" (calendar date, timezone-independent) */
export function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

export function formatTimestamp(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(iso));
}
