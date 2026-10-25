import { AppError } from "@/lib/http/errors";

const VALIDATION_MESSAGES: Record<string, string> = {
  INVALID_EFFORT: "Effort must be 15–2,400 minutes in 15-minute increments.",
  INVALID_DUE_DATE: "The revised due date cannot be earlier than the original due date.",
  INVALID_APPROVED_ITEMS: "Approved items must be 1–10 valid entries referring only to this project's baseline.",
  VALIDATION_FAILED: "Some fields are invalid.",
};

/**
 * Maps a Postgres / PostgREST error (routines raise their code as the message)
 * to the public error contract. Unknown failures become a generic INTERNAL error
 * so database details never reach the client.
 */
export function fromDbError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const e = (err ?? {}) as { code?: string; message?: string };
  const message = e.message ?? "";
  const known = /^[A-Z_]+$/.test(message) ? message : "";

  switch (known) {
    case "UNAUTHENTICATED":
    case "NOT_FOUND":
    case "FREE_LIMIT_REACHED":
    case "STALE_VERSION":
    case "DECISION_CONFLICT":
    case "PROJECT_ARCHIVED":
    case "UNAVAILABLE":
      return new AppError(known);
    case "IMMUTABLE_RECORD":
    case "BASELINE_IMMUTABLE":
      return new AppError("IMMUTABLE_RECORD");
    case "RATE_LIMITED_MINUTE":
      return new AppError("RATE_LIMITED", "Analysis limit reached (3 per minute). Wait a minute or enter items manually.");
    case "RATE_LIMITED_DAY":
      return new AppError("RATE_LIMITED", "Daily analysis limit reached (20 per day). Enter items manually.");
    case "INVALID_EFFORT":
    case "INVALID_DUE_DATE":
    case "INVALID_APPROVED_ITEMS":
    case "VALIDATION_FAILED":
      return new AppError("VALIDATION_FAILED", VALIDATION_MESSAGES[known]);
  }
  // SQLSTATE classes: 22 data exception, 23 integrity constraint violation.
  if (e.code?.startsWith("22") || e.code === "23514" || e.code === "23502") {
    return new AppError("VALIDATION_FAILED");
  }
  if (e.code === "23505") return new AppError("STALE_VERSION");
  // SQLSTATE only: messages can contain request data.
  console.error("Database error", e.code ?? "unknown");
  return new AppError("INTERNAL");
}
