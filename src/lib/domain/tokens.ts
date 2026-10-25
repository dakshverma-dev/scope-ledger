import { createHash, randomBytes } from "node:crypto";

/** 32 CSPRNG bytes, base64url: the review link bearer token. Never stored. */
export function generateReviewToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only this SHA-256 hex digest is persisted. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
