import { requireOwnerRepository } from "@/lib/auth/session";
import { AppError } from "@/lib/http/errors";
import { route } from "@/lib/http/route";
import { buildExportRecord, exportFileName, renderExportHtml } from "@/lib/services/export";

export const dynamic = "force-dynamic";

const COMMON = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex",
};

/**
 * Owner-only. Format by query parameter: ?format=html (default, readable page)
 * or ?format=json (downloadable attachment). Without the parameter, an
 * Accept: application/json header selects JSON.
 */
export const GET = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const repo = await requireOwnerRepository();
  const { id } = await ctx.params;
  const url = new URL(request.url);
  const param = url.searchParams.get("format");
  if (param !== null && param !== "html" && param !== "json") {
    throw new AppError("VALIDATION_FAILED", "format must be html or json.");
  }
  const wantsJson = param === "json" || (param === null && (request.headers.get("accept") ?? "").includes("application/json"));
  const record = await buildExportRecord(repo, id);

  if (wantsJson) {
    return new Response(JSON.stringify(record, null, 2), {
      headers: {
        ...COMMON,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exportFileName(record)}"`,
      },
    });
  }
  return new Response(renderExportHtml(record), {
    headers: {
      ...COMMON,
      "Content-Type": "text/html; charset=utf-8",
      // The record is static: no script may run even if escaping were bypassed.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  });
});
