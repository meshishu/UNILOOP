import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { gate, pageWindow, paged, parse } from "../common.ts";
import { authOf, requireAuth } from "../auth.ts";
import { ApiError, dbError, notFound } from "../errors.ts";
import { LISTING_COLUMNS, withCovers, type ListingRow } from "./listings.ts";

const displayName = z
  .string()
  .transform((v) => v.trim().replace(/\s+/g, " "))
  .refine((v) => v.length >= 2 && v.length <= 60 && !/[\u0000-\u001f\u007f]/.test(v), "Name must be 2-60 printable characters");

export async function meRoutes(app: FastifyInstance) {
  app.get("/me", { preHandler: requireAuth }, async (req) => {
    const { client, userId, email } = authOf(req);
    const [profile, campuses, prefs] = await Promise.all([
      client.from("profiles").select("id,display_name,account_status,created_at").eq("id", userId).maybeSingle(),
      client.from("campuses").select("id,name").order("id"),
      client.from("notification_preferences").select("email_messages,email_offers").eq("user_id", userId).maybeSingle(),
    ]);
    if (profile.error || campuses.error) throw new ApiError(502, "upstream_error", "Could not load your account.");
    return {
      data: {
        id: userId,
        email,
        profile: profile.data,
        // Empty until a campus membership is verified - the client should show a "pending approval" state.
        campuses: campuses.data ?? [],
        notification_preferences: prefs.data ?? { email_messages: true, email_offers: true },
      },
    };
  });

  app.patch("/me", { preHandler: [requireAuth, gate("userActions")] }, async (req) => {
    const { client, userId } = authOf(req);
    const body = parse(z.object({ display_name: displayName }), req.body);
    // An error-free UPDATE is not proof a row changed (RLS can filter it), so require the row back.
    const { data, error } = await client.from("profiles").update({ display_name: body.display_name }).eq("id", userId).select("id,display_name").maybeSingle();
    if (error) throw dbError(error, "Could not save your name.", 422);
    if (!data) throw notFound("Profile not found or not editable.");
    return { data };
  });

  app.put("/me/notification-preferences", { preHandler: [requireAuth, gate("userActions")] }, async (req) => {
    const { client, userId } = authOf(req);
    const prefs = parse(z.object({ email_messages: z.boolean(), email_offers: z.boolean() }), req.body);
    const { data: existing, error: readError } = await client.from("notification_preferences").select("user_id").eq("user_id", userId).maybeSingle();
    if (readError) throw dbError(readError, "Could not load preferences.");
    const { error } = existing
      ? await client.from("notification_preferences").update(prefs).eq("user_id", userId)
      : await client.from("notification_preferences").insert({ ...prefs, user_id: userId });
    if (error) throw dbError(error, "Could not save preferences.", 422);
    return { data: prefs };
  });

  app.get("/me/favorites", { preHandler: requireAuth }, async (req) => {
    const { client, userId } = authOf(req);
    const w = pageWindow(req.query);
    const { data: saved, error } = await client
      .from("favorites").select("listing_id,created_at").eq("user_id", userId)
      .order("created_at", { ascending: false }).order("listing_id", { ascending: false }).range(w.from, w.to);
    if (error) throw new ApiError(502, "upstream_error", "Could not load saved items.");
    const rows = saved ?? [];
    const ids = rows.slice(0, w.limit).map((r: { listing_id: string }) => r.listing_id);
    let items: ListingRow[] = [];
    if (ids.length) {
      const { data: listings, error: listError } = await client.from("listings").select(LISTING_COLUMNS).in("id", ids).eq("status", "active");
      if (listError) throw new ApiError(502, "upstream_error", "Could not load saved items.");
      const order = new Map(ids.map((id: string, i: number) => [id, i]));
      items = ((listings ?? []) as ListingRow[]).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
      items = await withCovers(client, items);
    }
    const out = paged(rows, w);
    return { data: items, page: out.page };
  });
}
