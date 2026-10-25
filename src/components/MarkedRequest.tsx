import { segmentByQuotes } from "@/lib/domain/evidence";

/** The client's request with each cited quote highlighted in place and numbered to its item. */
export function MarkedRequest({ text, quotes }: { text: string; quotes: (string | null)[] }) {
  const segments = segmentByQuotes(text, quotes);
  return (
    <p className="request-quote">
      {segments.map((s, i) =>
        s.mark === null ? (
          <span key={i}>{s.text}</span>
        ) : (
          <mark key={i} className="evidence">
            {s.text}
            <sup aria-label={`evidence for item ${s.mark + 1}`}>{s.mark + 1}</sup>
          </mark>
        ),
      )}
    </p>
  );
}
