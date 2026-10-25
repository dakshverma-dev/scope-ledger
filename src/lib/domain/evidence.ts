/** Whitespace-only normalisation: collapse runs of whitespace and trim. Nothing else changes. */
export function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** True when `quote` is a literal substring of `text` after whitespace normalisation only. */
export function isLiteralQuote(text: string, quote: string): boolean {
  const q = normalizeWhitespace(quote);
  return q.length > 0 && normalizeWhitespace(text).includes(q);
}

export interface Segment {
  text: string;
  /** Index into the quotes array when this segment is quoted evidence. */
  mark: number | null;
}

/**
 * Splits `text` into plain and highlighted segments for display, matching each
 * quote with flexible whitespace. Overlapping or unmatched quotes are skipped.
 */
export function segmentByQuotes(text: string, quotes: (string | null)[]): Segment[] {
  const ranges: { start: number; end: number; mark: number }[] = [];
  quotes.forEach((quote, mark) => {
    if (!quote) return;
    const words = normalizeWhitespace(quote).split(" ").filter(Boolean);
    if (!words.length) return;
    const pattern = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"));
    const m = pattern.exec(text);
    if (!m) return;
    const start = m.index;
    const end = start + m[0].length;
    if (ranges.some((r) => start < r.end && end > r.start)) return;
    ranges.push({ start, end, mark });
  });
  ranges.sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  let pos = 0;
  for (const r of ranges) {
    if (r.start > pos) out.push({ text: text.slice(pos, r.start), mark: null });
    out.push({ text: text.slice(r.start, r.end), mark: r.mark });
    pos = r.end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), mark: null });
  return out;
}
