import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { gate, idParams, pageWindow, paged, parse } from "../common.ts";
import { authOf, requireAuth } from "../auth.ts";
import { ApiError, dbError, notFound } from "../errors.ts";

const TX_COLUMNS =
  "id,offer_id,listing_id,buyer_id,seller_id,agreed_price_inr,status,buyer_received_at,seller_handed_over_at,created_at,completed_at";

// Handover record only: UNILOOP does not process or hold payments.
export async function transactionRoutes(app: FastifyInstance) {
  const sales = [requireAuth, gate("sales")];

  app.post("/offers/:id/transactions", { preHandler: sales }, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const { data, error } = await authOf(req).client.rpc("start_sale_transaction", { requested_offer: id });
    if (error || typeof data !== "string") throw dbError(error, "Could not start a handover record.");
    return reply.status(201).send({ data: { id: data } });
  });

  app.get("/transactions", { preHandler: requireAuth }, async (req) => {
    const { client } = authOf(req);
    const w = pageWindow(req.query);
    const { data, error } = await client.from("sale_transactions").select(TX_COLUMNS)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).range(w.from, w.to);
    if (error) throw new ApiError(502, "upstream_error", "Could not load transactions.");
    return paged(data, w);
  });

  app.get("/transactions/:id", { preHandler: requireAuth }, async (req) => {
    const { id } = parse(idParams, req.params);
    const { client } = authOf(req);
    const { data, error } = await client.from("sale_transactions").select(TX_COLUMNS).eq("id", id).maybeSingle();
    if (error) throw new ApiError(502, "upstream_error", "Could not load the transaction.");
    if (!data) throw notFound("Transaction not found.");
    const [listing, reviews] = await Promise.all([
      client.from("listings").select("id,title,status").eq("id", (data as { listing_id: string }).listing_id).maybeSingle(),
      client.from("sale_reviews").select("id,reviewer_id,reviewed_user_id,rating,review_body,created_at").eq("transaction_id", id),
    ]);
    return { data: { ...data, listing: listing.data ?? null, reviews: reviews.data ?? [] } };
  });

  // Each party confirms independently; the sale completes when both have.
  app.post("/transactions/:id/confirm", { preHandler: sales }, async (req) => {
    const { id } = parse(idParams, req.params);
    const { error } = await authOf(req).client.rpc("confirm_sale_exchange", { requested_transaction: id });
    if (error) throw dbError(error, "Confirmation is not allowed for this transaction.");
    return { data: { id, confirmed: true } };
  });

  app.post("/transactions/:id/review", { preHandler: sales }, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const body = parse(z.object({ stars: z.number().int().min(1).max(5), details: z.string().trim().min(15).max(1000) }), req.body);
    const { error } = await authOf(req).client.rpc("review_completed_sale", { requested_transaction: id, stars: body.stars, details: body.details });
    if (error) throw dbError(error, "Unable to save review. Only one review per completed exchange.");
    return reply.status(201).send({ data: { saved: true } });
  });
}
