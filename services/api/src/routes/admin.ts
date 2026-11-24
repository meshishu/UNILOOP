import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { gate, idParams, parse } from "../common.ts";
import { authOf, requireAuth } from "../auth.ts";
import { dbError } from "../errors.ts";

// Moderator-only. Authorization is enforced inside the SQL functions
// (private.is_market_moderator()); a non-moderator gets 403 from Postgres.
export async function adminRoutes(app: FastifyInstance) {
  const mod = [requireAuth, gate("userActions")];

  app.get("/admin/reports", { preHandler: mod }, async (req) => {
    const { page } = parse(z.object({ page: z.coerce.number().int().min(1).max(1000).default(1) }), req.query);
    const { data, error } = await authOf(req).client.rpc("get_open_listing_reports_page", { page_number: page });
    if (error) throw dbError(error, "Could not load the moderation queue.", 422);
    const rows = (data ?? []) as unknown[];
    // The function returns up to 25 rows for a 24-row page; the extra row signals another page.
    return { data: rows.slice(0, 24), page: { page, limit: 24, hasMore: rows.length > 24 } };
  });

  app.post("/admin/reports/:id/review", { preHandler: mod }, async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(z.object({ resolution: z.enum(["dismiss", "remove_listing"]) }), req.body);
    const { error } = await authOf(req).client.rpc("review_listing_report", { report_id: id, resolution: body.resolution });
    if (error) throw dbError(error, "Review was not permitted or is no longer pending.");
    return { data: { id, resolution: body.resolution } };
  });
}
