import { AppError } from "./errors";

/**
 * Same-origin check for state-changing requests (CSRF defence for cookie-backed
 * owner routes and the bearer-token decision route). The Origin header must
 * match the configured public origin or, when none is configured, the origin
 * the request was addressed to.
 */
export function assertSameOrigin(request: Request, configuredBaseUrl: string | undefined): void {
  const origin = request.headers.get("origin");
  const allowed = new Set<string>();
  if (configuredBaseUrl) allowed.add(new URL(configuredBaseUrl).origin);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
    allowed.add(`${proto}://${host}`);
  }
  allowed.add(new URL(request.url).origin);

  if (origin) {
    if (allowed.has(origin)) return;
    throw new AppError("FORBIDDEN_ORIGIN");
  }
  // Browsers always send Origin on cross-site POSTs; fall back to Fetch Metadata.
  if (request.headers.get("sec-fetch-site") === "same-origin") return;
  throw new AppError("FORBIDDEN_ORIGIN");
}
