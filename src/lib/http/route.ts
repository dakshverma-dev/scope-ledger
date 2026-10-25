import { NextResponse } from "next/server";
import type { z } from "zod";
import { describeIssues } from "@/lib/domain/validation";
import { AppError, errorBody } from "./errors";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0, must-revalidate" };
export const MAX_BODY_BYTES = 32 * 1024;

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(data, { status, headers: { ...NO_STORE, ...headers } });
}

export function errorResponse(err: unknown) {
  const appErr = err instanceof AppError ? err : new AppError("INTERNAL");
  if (!(err instanceof AppError)) {
    // Log the failure class only; request bodies and tokens are never logged.
    console.error("Unhandled route error:", err instanceof Error ? err.name : typeof err);
  }
  return json(errorBody(appErr), appErr.status);
}

/** Wraps a handler so every failure becomes the structured JSON error contract. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** Reads a bounded JSON body and validates it. Oversized or malformed bodies are 422. */
export async function readJson<S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S>> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) throw new AppError("VALIDATION_FAILED", "Request body too large.");
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    throw new AppError("VALIDATION_FAILED", "Expected application/json.");
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new AppError("VALIDATION_FAILED", "Request body too large.");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AppError("VALIDATION_FAILED", "Malformed JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_FAILED", describeIssues(parsed.error));
  return parsed.data;
}

export function parseParam<S extends z.ZodType>(value: unknown, schema: S, notFound: AppError): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw notFound;
  return parsed.data;
}
