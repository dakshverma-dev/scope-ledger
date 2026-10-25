export type ErrorCode =
  | "UNAUTHENTICATED"
  | "NOT_FOUND"
  | "FORBIDDEN_ORIGIN"
  | "VALIDATION_FAILED"
  | "STALE_VERSION"
  | "DECISION_CONFLICT"
  | "PROJECT_ARCHIVED"
  | "IMMUTABLE_RECORD"
  | "FREE_LIMIT_REACHED"
  | "RATE_LIMITED"
  | "UNAVAILABLE"
  | "ANALYSIS_UNAVAILABLE"
  | "SERVICE_NOT_CONFIGURED"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  NOT_FOUND: 404,
  FORBIDDEN_ORIGIN: 403,
  VALIDATION_FAILED: 422,
  STALE_VERSION: 409,
  DECISION_CONFLICT: 409,
  PROJECT_ARCHIVED: 409,
  IMMUTABLE_RECORD: 409,
  FREE_LIMIT_REACHED: 429,
  RATE_LIMITED: 429,
  UNAVAILABLE: 404,
  ANALYSIS_UNAVAILABLE: 503,
  SERVICE_NOT_CONFIGURED: 503,
  INTERNAL: 500,
};

const DEFAULT_MESSAGE: Record<ErrorCode, string> = {
  UNAUTHENTICATED: "Start the demo to create a workspace session.",
  NOT_FOUND: "That record is not available in your workspace.",
  FORBIDDEN_ORIGIN: "Request origin not allowed.",
  VALIDATION_FAILED: "Some fields are invalid.",
  STALE_VERSION: "The proposal changed since you started. Reload to see the current version.",
  DECISION_CONFLICT: "A different decision has already been recorded for this version.",
  PROJECT_ARCHIVED: "This project is archived.",
  IMMUTABLE_RECORD: "Published records cannot be changed.",
  FREE_LIMIT_REACHED: "The free workspace includes one active project.",
  RATE_LIMITED: "Analysis limit reached. Try again later or enter items manually.",
  UNAVAILABLE: "This review link is unavailable.",
  ANALYSIS_UNAVAILABLE: "Analysis unavailable. Your draft is kept; you can enter items manually.",
  SERVICE_NOT_CONFIGURED: "A required service is not configured on this deployment.",
  INTERNAL: "Something went wrong. Nothing was published; your draft is kept.",
};

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message?: string,
  ) {
    super(message ?? DEFAULT_MESSAGE[code]);
    this.status = STATUS[code];
  }
}

export function errorBody(err: AppError) {
  return { error: { code: err.code, message: err.message } };
}
