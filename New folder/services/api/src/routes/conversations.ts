import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { gate, idParams, nonce, pageWindow, paged, parse, uuid } from "../common.ts";
import { authOf, requireAuth } from "../auth.ts";
import { ApiError, dbError, notFound } from "../errors.ts";

const OFFER_COLUMNS = "id,conversation_id,listing_id,proposer_id,recipient_id,parent_offer_id,amount_inr,status,created_at,decided_at";

export async function conversationRoutes(app: FastifyInstance) {
  const chat = [requireAuth, gate("interactions")];

  // Idempotent: returns the existing thread for (listing, buyer) when there is one.
  app.post("/listings/:id/conversations", { preHandler: chat }, async (req) => {
    const { id } = parse(idParams, req.params);
    const { data, error } = await authOf(req).client.rpc("open_sale_conversation", { requested_listing: id });
    if (error || typeof data !== "string") throw dbError(error, "Unable to start this conversation.");
    return { data: { id: data } };
  });

  // ?offers=true lists only threads that contain at least one offer.
  app.get("/conversations", { preHandler: requireAuth }, async (req) => {
    const { client } = authOf(req);
    const w = pageWindow(req.query);
    const { offers } = parse(z.object({ offers: z.enum(["true", "false"]).default("false") }), req.query);
    const select = offers === "true"
      ? "id,listing_id,buyer_id,seller_id,created_at,sale_offers!inner(id)"
      : "id,listing_id,buyer_id,seller_id,created_at";
    const { data, error } = await client.from("sale_conversations").select(select)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).range(w.from, w.to);
    if (error) throw new ApiError(502, "upstream_error", "Could not load conversations.");
    const out = paged(data as unknown as { id: string; listing_id: string }[], w);
    const ids = [...new Set(out.data.map((t) => t.listing_id))];
    const titles = new Map<string, string>();
    if (ids.length) {
      const { data: listings } = await client.from("listings").select("id,title").in("id", ids);
      for (const l of (listings ?? []) as { id: string; title: string }[]) titles.set(l.id, l.title);
    }
    const items = out.data.map((t) => {
      const { sale_offers: _drop, ...row } = t as Record<string, unknown>;
      return { ...row, listing_title: titles.get(t.listing_id) ?? null };
    });
    return { data: items, page: out.page };
  });

  app.get("/conversations/:id", { preHandler: requireAuth }, async (req) => {
    const { id } = parse(idParams, req.params);
    const { client, userId } = authOf(req);
    const w = pageWindow(req.query, 30);
    const { data: conv, error } = await client.from("sale_conversations").select("id,listing_id,buyer_id,seller_id,created_at").eq("id", id).maybeSingle();
    if (error) throw new ApiError(502, "upstream_error", "Could not load the conversation.");
    if (!conv) throw notFound("Conversation not found.");
    const c = conv as { listing_id: string; buyer_id: string; seller_id: string };
    const otherId = c.buyer_id === userId ? c.seller_id : c.buyer_id;
    const [messages, offers, listing, blocked] = await Promise.all([
      client.from("sale_messages").select("id,conversation_id,sender_id,message_body,created_at").eq("conversation_id", id)
        .order("created_at", { ascending: false }).order("id", { ascending: false }).range(w.from, w.to),
      client.from("sale_offers").select(OFFER_COLUMNS).eq("conversation_id", id)
        .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(50),
      client.from("listings").select("id,title,price_inr,status").eq("id", c.listing_id).maybeSingle(),
      client.from("user_blocks").select("blocked_id").eq("blocker_id", userId).eq("blocked_id", otherId).maybeSingle(),
    ]);
    if (messages.error || offers.error) throw new ApiError(502, "upstream_error", "Could not load the conversation.");
    const m = paged(messages.data, w);
    return {
      data: {
        ...conv,
        counterparty_id: otherId,
        listing: listing.data ?? null,
        you_blocked_counterparty: Boolean(blocked.data),
        messages: m.data, // newest first
        messages_page: m.page,
        offers: offers.data ?? [],
      },
    };
  });

  // `nonce` is the idempotency key: reuse the same value when retrying a failed network call.
  app.post("/conversations/:id/messages", { preHandler: chat }, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const body = parse(z.object({ body: z.string().trim().min(1).max(2000), nonce }), req.body);
    const { error } = await authOf(req).client.rpc("send_sale_message", { requested_conversation: id, content: body.body, request_nonce: body.nonce });
    if (error) throw dbError(error, "Could not send. You may need to wait before sending again.");
    return reply.status(201).send({ data: { sent: true } });
  });

  app.post("/conversations/:id/offers", { preHandler: chat }, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const body = parse(z.object({
      amount_inr: z.number().int().min(1).max(10_000_000),
      parent_offer_id: uuid.nullable().default(null),
      nonce,
    }), req.body);
    const { error } = await authOf(req).client.rpc("submit_sale_offer", {
      requested_conversation: id, requested_amount: body.amount_inr, parent_offer: body.parent_offer_id, request_nonce: body.nonce,
    });
    if (error) throw dbError(error, "Offer could not be placed. Refresh to see the latest negotiation state.");
    return reply.status(201).send({ data: { placed: true } });
  });

  app.post("/offers/:id/resolve", { preHandler: chat }, async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(z.object({ decision: z.enum(["accept", "reject", "withdraw"]) }), req.body);
    const { error } = await authOf(req).client.rpc("resolve_sale_offer", { requested_offer: id, decision: body.decision });
    if (error) throw dbError(error, "Offer changed or the action is not allowed.");
    return { data: { id, decision: body.decision } };
  });

  app.put("/users/:id/block", { preHandler: chat }, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const { client, userId } = authOf(req);
    const { error } = await client.from("user_blocks").insert({ blocker_id: userId, blocked_id: id });
    if (error && error.code !== "23505") throw dbError(error, "Unable to change contact preference.", 422);
    return reply.status(204).send();
  });

  app.delete("/users/:id/block", { preHandler: chat }, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const { client, userId } = authOf(req);
    const { error } = await client.from("user_blocks").delete().eq("blocker_id", userId).eq("blocked_id", id);
    if (error) throw dbError(error, "Unable to change contact preference.", 422);
    return reply.status(204).send();
  });
}
