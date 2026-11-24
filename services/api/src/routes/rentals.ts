import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { categorySlug, condition, gate, idParams, isoDate, nonce, pageWindow, paged, parse, signPaths } from "../common.ts";
import { authOf, campusOf, requireAuth } from "../auth.ts";
import { ApiError, dbError, notFound } from "../errors.ts";
import { attachPhoto } from "../photos.ts";
import { cleanSearch, withCovers } from "./listings.ts";

const RENTAL_COLUMNS =
  "id,owner_id,campus_id,category_slug,title,description,daily_rate_inr,refundable_deposit_inr,min_days,max_days,item_condition,status,created_at,published_at";
const BOOKING_COLUMNS =
  "id,rental_id,owner_id,renter_id,booking_period,days_count,daily_rate_snapshot_inr,rental_total_inr,deposit_snapshot_inr,status,owner_handover_at,renter_handover_at,owner_return_at,renter_return_at,created_at";

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const days = z.number().int().min(1).max(90);

const rentalBody = z.object({
  title: text(8, 120),
  description: text(20, 5000),
  category_slug: categorySlug,
  daily_rate_inr: z.number().int().min(1).max(1_000_000),
  refundable_deposit_inr: z.number().int().min(0).max(10_000_000).default(0),
  min_days: days.default(1),
  max_days: days.default(30),
  item_condition: condition,
}).refine((v) => v.min_days <= v.max_days, { message: "min_days must be <= max_days", path: ["min_days"] });

const dateRange = z.object({ start_date: isoDate, return_date: isoDate, nonce })
  .refine((v) => v.return_date > v.start_date, { message: "return_date must be after start_date", path: ["return_date"] });

export async function rentalRoutes(app: FastifyInstance) {
  const rent = [requireAuth, gate("rentals")];

  app.get("/rentals", { preHandler: requireAuth }, async (req) => {
    const { client } = authOf(req);
    const { active } = await campusOf(req);
    const w = pageWindow(req.query, 18);
    const q = parse(z.object({ category: categorySlug.optional(), q: z.string().optional() }), req.query);
    let query = client.from("rental_listings").select(RENTAL_COLUMNS).eq("campus_id", active.id).eq("status", "active")
      .order("published_at", { ascending: false }).order("id", { ascending: false }).range(w.from, w.to);
    if (q.category) query = query.eq("category_slug", q.category);
    const term = cleanSearch(q.q);
    if (term) query = query.textSearch("search_document", term, { config: "simple", type: "plain" });
    const { data, error } = await query;
    if (error) throw new ApiError(502, "upstream_error", "Could not load rentals.");
    const out = paged(data as { id: string }[], w);
    return { data: await withCovers(client, out.data, "rental_photos"), page: out.page };
  });

  app.get("/rentals/mine", { preHandler: requireAuth }, async (req) => {
    const { client, userId } = authOf(req);
    const w = pageWindow(req.query);
    const { data, error } = await client.from("rental_listings").select(RENTAL_COLUMNS).eq("owner_id", userId)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).range(w.from, w.to);
    if (error) throw new ApiError(502, "upstream_error", "Could not load your rentals.");
    const out = paged(data as { id: string }[], w);
    return { data: await withCovers(client, out.data, "rental_photos"), page: out.page };
  });

  app.post("/rentals", { preHandler: rent }, async (req, reply) => {
    const { client, userId } = authOf(req);
    const { active } = await campusOf(req);
    const body = parse(rentalBody, req.body);
    const { data, error } = await client.from("rental_listings").insert({ ...body, owner_id: userId, campus_id: active.id }).select("id").single();
    if (error || !data) throw dbError(error, "Could not save the rental draft.", 422);
    return reply.status(201).send({ data: { id: data.id, status: "draft" } });
  });

  app.get("/rentals/:id", { preHandler: requireAuth }, async (req) => {
    const { id } = parse(idParams, req.params);
    const { client, userId } = authOf(req);
    const { active } = await campusOf(req);
    const { data, error } = await client.from("rental_listings").select(RENTAL_COLUMNS).eq("id", id).eq("campus_id", active.id).maybeSingle();
    if (error) throw new ApiError(502, "upstream_error", "Could not load the rental.");
    if (!data) throw notFound("Rental not found.");
    const [photoRows, busy] = await Promise.all([
      client.from("rental_photos").select("storage_path,position").eq("rental_id", id).order("position").limit(5),
      client.rpc("get_rental_busy_periods", { requested_rental: id }),
    ]);
    const paths = (photoRows.data ?? []).map((p: { storage_path: string }) => p.storage_path);
    const urls = await signPaths(client, "rental-media", paths);
    return {
      data: {
        ...data,
        is_owner: (data as { owner_id: string }).owner_id === userId,
        photos: paths.map((p: string) => urls.get(p)).filter(Boolean),
        busy_periods: busy.error ? [] : busy.data ?? [],
      },
    };
  });

  app.post("/rentals/:id/status", { preHandler: rent }, async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(z.object({ status: z.enum(["active", "paused", "removed"]) }), req.body);
    const { error } = await authOf(req).client.rpc("change_rental_listing", { requested_rental: id, target_status: body.status });
    if (error) throw dbError(error, "Change unavailable. Add a photo before publishing and review the current state.");
    return { data: { id, status: body.status } };
  });

  app.post("/rentals/:id/photos", { preHandler: rent }, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const photo = await attachPhoto(req, { bucket: "rental-media", table: "rental_photos", parentColumn: "rental_id", parentId: id });
    return reply.status(201).send({ data: photo });
  });

  // Owner blocks dates (e.g. exam week). The exclusion constraint in Postgres is the concurrency authority.
  app.post("/rentals/:id/blocks", { preHandler: rent }, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const b = parse(dateRange, req.body);
    const { error } = await authOf(req).client.rpc("block_rental_period", {
      requested_rental: id, start_date: b.start_date, return_date: b.return_date, p_nonce: b.nonce,
    });
    if (error) throw dbError(error, "Cannot block these dates. They may already be confirmed.");
    return reply.status(201).send({ data: { blocked: true } });
  });

  app.post("/rentals/:id/bookings", { preHandler: rent }, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const b = parse(dateRange, req.body);
    const { data, error } = await authOf(req).client.rpc("request_rental_booking", {
      requested_rental: id, start_date: b.start_date, return_date: b.return_date, p_nonce: b.nonce,
    });
    if (error || typeof data !== "string") throw dbError(error, "These dates could not be requested. Check availability and duration.");
    return reply.status(201).send({ data: { id: data } });
  });

  app.get("/bookings", { preHandler: requireAuth }, async (req) => {
    const { client } = authOf(req);
    const w = pageWindow(req.query);
    const { data, error } = await client.from("rental_bookings").select(BOOKING_COLUMNS)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).range(w.from, w.to);
    if (error) throw new ApiError(502, "upstream_error", "Could not load bookings.");
    return paged(data, w);
  });

  app.get("/bookings/:id", { preHandler: requireAuth }, async (req) => {
    const { id } = parse(idParams, req.params);
    const { client } = authOf(req);
    const w = pageWindow(req.query, 20);
    const { data, error } = await client.from("rental_bookings").select(BOOKING_COLUMNS).eq("id", id).maybeSingle();
    if (error) throw new ApiError(502, "upstream_error", "Could not load the booking.");
    if (!data) throw notFound("Booking not found.");
    const [rental, notes] = await Promise.all([
      client.from("rental_listings").select("id,title,status").eq("id", (data as { rental_id: string }).rental_id).maybeSingle(),
      client.from("rental_condition_notes").select("id,author_id,stage,note,created_at").eq("booking_id", id)
        .order("created_at", { ascending: false }).order("id", { ascending: false }).range(w.from, w.to),
    ]);
    const n = paged(notes.data, w);
    return { data: { ...data, rental: rental.data ?? null, condition_notes: n.data, condition_notes_page: n.page } };
  });

  app.post("/bookings/:id/decision", { preHandler: rent }, async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(z.object({ decision: z.enum(["approve", "decline", "cancel", "confirm_handover", "confirm_return"]) }), req.body);
    const { error } = await authOf(req).client.rpc("decide_rental_booking", { requested_booking: id, decision: body.decision });
    if (error) throw dbError(error, "This action isn't available in the current rental state.");
    return { data: { id, decision: body.decision } };
  });

  app.post("/bookings/:id/notes", { preHandler: rent }, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const body = parse(z.object({ stage: z.enum(["pickup", "return", "incident"]), note: text(10, 1200) }), req.body);
    const { error } = await authOf(req).client.rpc("add_rental_condition_note", { requested_booking: id, stage: body.stage, content: body.note });
    if (error) throw dbError(error, "This note could not be saved.");
    return reply.status(201).send({ data: { saved: true } });
  });
}
