import type { FastifyInstance } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { categorySlug, condition, gate, idParams, pageWindow, paged, parse, signPaths } from "../common.ts";
import { authOf, campusOf, requireAuth } from "../auth.ts";
import { ApiError, dbError, notFound } from "../errors.ts";
import { attachPhoto } from "../photos.ts";

export const LISTING_COLUMNS =
  "id,owner_id,campus_id,category_slug,title,description,price_inr,item_condition,status,created_at,published_at";

export type ListingRow = {
  id: string; owner_id: string; campus_id: string; category_slug: string; title: string;
  description: string; price_inr: number; item_condition: string; status: string;
  created_at: string; published_at: string | null; photo_url?: string | null;
};

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

export const listingBody = z.object({
  title: text(8, 120),
  description: text(20, 5000),
  category_slug: categorySlug,
  price_inr: z.number().int().min(1).max(10_000_000),
  item_condition: condition,
});

/** Attach a short-lived signed cover-photo URL to each listing (first photo by position). */
export async function withCovers<T extends { id: string }>(
  client: SupabaseClient,
  items: T[],
  table: "listing_photos" | "rental_photos" = "listing_photos",
): Promise<(T & { photo_url: string | null })[]> {
  if (!items.length) return [];
  const column = table === "listing_photos" ? "listing_id" : "rental_id";
  const bucket = table === "listing_photos" ? "listing-media" : "rental-media";
  const { data } = await client.from(table).select(`${column},storage_path,position`).in(column, items.map((i) => i.id)).order("position", { ascending: true });
  const cover = new Map<string, string>();
  for (const row of (data ?? []) as Record<string, string>[]) {
    const parent = row[column]!;
    if (!cover.has(parent)) cover.set(parent, row.storage_path!);
  }
  const urls = await signPaths(client, bucket, [...cover.values()]);
  return items.map((i) => ({ ...i, photo_url: cover.has(i.id) ? urls.get(cover.get(i.id)!) ?? null : null }));
}

export function cleanSearch(q: unknown): string {
  return typeof q === "string" ? q.trim().replace(/\s+/g, " ").slice(0, 100) : "";
}

export async function listingRoutes(app: FastifyInstance) {
  app.get("/categories", { preHandler: requireAuth }, async (req) => {
    const { client } = authOf(req);
    const { data, error } = await client.from("categories").select("slug,label,sort_order").eq("enabled", true).order("sort_order").order("slug");
    if (error) throw new ApiError(502, "upstream_error", "Could not load categories.");
    return { data: data ?? [] };
  });

  app.get("/campuses", { preHandler: requireAuth }, async (req) => {
    const { campuses, active } = await campusOf(req);
    return { data: campuses, active_campus_id: active.id };
  });

  // Buy discovery: active listings on the caller's active campus.
  app.get("/listings", { preHandler: requireAuth }, async (req) => {
    const { client } = authOf(req);
    const { active } = await campusOf(req);
    const w = pageWindow(req.query, 18);
    const q = parse(z.object({ category: categorySlug.optional(), q: z.string().optional() }), req.query);
    let query = client.from("listings").select(LISTING_COLUMNS)
      .eq("campus_id", active.id).eq("status", "active")
      .order("published_at", { ascending: false }).order("id", { ascending: false }).range(w.from, w.to);
    if (q.category) query = query.eq("category_slug", q.category);
    const term = cleanSearch(q.q);
    // Plain-text full-text search (no caller-supplied tsquery operators); campus RLS still applies.
    if (term) query = query.textSearch("search_document", term, { config: "simple", type: "plain" });
    const { data, error } = await query;
    if (error) throw new ApiError(502, "upstream_error", "Could not load listings.");
    const out = paged(data as ListingRow[], w);
    return { data: await withCovers(client, out.data), page: out.page };
  });

  app.get("/listings/mine", { preHandler: requireAuth }, async (req) => {
    const { client, userId } = authOf(req);
    const w = pageWindow(req.query);
    const { data, error } = await client.from("listings").select(LISTING_COLUMNS).eq("owner_id", userId)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).range(w.from, w.to);
    if (error) throw new ApiError(502, "upstream_error", "Could not load your listings.");
    const out = paged(data as ListingRow[], w);
    return { data: await withCovers(client, out.data), page: out.page };
  });

  app.post("/listings", { preHandler: [requireAuth, gate("writes")] }, async (req, reply) => {
    const { client, userId } = authOf(req);
    const { active } = await campusOf(req);
    const body = parse(listingBody, req.body);
    const { data, error } = await client.from("listings")
      .insert({ ...body, owner_id: userId, campus_id: active.id, mode: "sell" }).select("id").single();
    if (error || !data) throw dbError(error, "Could not save the draft.", 422);
    return reply.status(201).send({ data: { id: data.id, status: "draft" } });
  });

  app.get("/listings/:id", { preHandler: requireAuth }, async (req) => {
    const { id } = parse(idParams, req.params);
    const { client, userId } = authOf(req);
    const { active } = await campusOf(req);
    const { data, error } = await client.from("listings").select(LISTING_COLUMNS).eq("id", id).eq("campus_id", active.id).maybeSingle();
    if (error) throw new ApiError(502, "upstream_error", "Could not load the listing.");
    if (!data) throw notFound("Listing not found.");
    const [photoRows, fav] = await Promise.all([
      client.from("listing_photos").select("storage_path,position").eq("listing_id", id).order("position").limit(5),
      client.from("favorites").select("listing_id").eq("user_id", userId).eq("listing_id", id).maybeSingle(),
    ]);
    const paths = (photoRows.data ?? []).map((p: { storage_path: string }) => p.storage_path);
    const urls = await signPaths(client, "listing-media", paths);
    return {
      data: {
        ...(data as ListingRow),
        is_owner: (data as ListingRow).owner_id === userId,
        favorited: Boolean(fav.data),
        photos: paths.map((p: string) => urls.get(p)).filter(Boolean),
        photo_count: paths.length,
      },
    };
  });

  // SQL function owns the lifecycle rules and row locking (publish needs >=1 photo, etc.).
  app.post("/listings/:id/status", { preHandler: [requireAuth, gate("writes")] }, async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(z.object({ status: z.enum(["active", "paused", "sold", "removed"]) }), req.body);
    const { error } = await authOf(req).client.rpc("transition_sale_listing", { listing_id: id, next_status: body.status });
    if (error) throw dbError(error, "This change is not available for this listing.");
    return { data: { id, status: body.status } };
  });

  app.post("/listings/:id/photos", { preHandler: [requireAuth, gate("writes")] }, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const photo = await attachPhoto(req, { bucket: "listing-media", table: "listing_photos", parentColumn: "listing_id", parentId: id });
    return reply.status(201).send({ data: photo });
  });

  app.put("/listings/:id/favorite", { preHandler: [requireAuth, gate("userActions")] }, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const { client, userId } = authOf(req);
    const { error } = await client.from("favorites").insert({ user_id: userId, listing_id: id });
    if (error && error.code !== "23505") throw dbError(error, "Could not save this item.", 422);
    return reply.status(204).send();
  });

  app.delete("/listings/:id/favorite", { preHandler: [requireAuth, gate("userActions")] }, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const { client, userId } = authOf(req);
    const { error } = await client.from("favorites").delete().eq("user_id", userId).eq("listing_id", id);
    if (error) throw dbError(error, "Could not update saved items.", 422);
    return reply.status(204).send();
  });

  app.post("/listings/:id/reports", { preHandler: [requireAuth, gate("userActions")] }, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const body = parse(z.object({
      reason: z.enum(["prohibited", "fraud", "misleading", "harassment", "other"]),
      details: text(15, 1500),
    }), req.body);
    const { client, userId } = authOf(req);
    const { error } = await client.from("listing_reports").insert({ listing_id: id, reporter_id: userId, ...body });
    if (error) throw dbError(error, "Could not submit the report.", 422);
    return reply.status(201).send({ data: { received: true } });
  });
}
