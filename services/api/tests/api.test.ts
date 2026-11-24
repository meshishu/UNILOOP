import { test } from "node:test";
import assert from "node:assert/strict";
import { campusRows, CAMPUS_A, CAMPUS_B, harness, has, LISTING_ID, multipart, opArgs, TOKEN, USER_ID, type Handler } from "./helpers.ts";
import { loadConfig } from "../src/config.ts";
import { sniffImage } from "../src/photos.ts";

const validListing = {
  title: "Engineering Mathematics textbook", description: "Barely used, no markings, all chapters intact.",
  category_slug: "books-study", price_inr: 450, item_condition: "good",
};
const json = (r: { body: string }) => JSON.parse(r.body);

test("config refuses a service_role key and invalid urls", () => {
  const payload = Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url");
  const jwt = `eyJhbGciOiJIUzI1NiJ9.${payload}.sig_sig_sig_sig_sig`;
  assert.throws(() => loadConfig({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_PUBLISHABLE_KEY: jwt }), /service_role/);
  assert.throws(() => loadConfig({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_secret_" + "a".repeat(30) }), /service_role/);
  assert.throws(() => loadConfig({ SUPABASE_URL: "nope", SUPABASE_PUBLISHABLE_KEY: "k".repeat(30) }), /Invalid configuration/);
});

test("mutation gates default to off", async () => {
  const { config } = await harness();
  assert.deepEqual(Object.values(config.gates), [false, false, false, false, false]);
});

test("auth: missing, malformed and rejected tokens give 401; unconfirmed email gives 403", async () => {
  const h = await harness();
  assert.equal((await h.app.inject({ url: "/v1/me" })).statusCode, 401);
  assert.equal((await h.app.inject({ url: "/v1/me", headers: { authorization: "Basic abc" } })).statusCode, 401);
  assert.equal((await h.app.inject({ url: "/v1/me", headers: { authorization: "Bearer " + "z".repeat(40) } })).statusCode, 401);
  const h2 = await harness({ user: { email_confirmed_at: null } });
  const r = await h2.app.inject({ url: "/v1/me", headers: h2.authz });
  assert.equal(r.statusCode, 403);
  assert.equal(json(r).error.code, "email_unconfirmed");
});

test("every response is no-store and unknown routes return JSON 404", async () => {
  const h = await harness();
  const r = await h.app.inject({ url: "/nope" });
  assert.equal(r.statusCode, 404);
  assert.equal(r.headers["cache-control"], "no-store");
  assert.equal(json(r).error.code, "not_found");
  assert.equal((await h.app.inject({ url: "/healthz" })).statusCode, 200);
  assert.equal((await h.app.inject({ url: "/readyz" })).statusCode, 200);
});

test("writes are blocked with 503 while the gate is off", async () => {
  const h = await harness({ handler: campusRows });
  const r = await h.app.inject({ method: "POST", url: "/v1/listings", headers: h.authz, payload: validListing });
  assert.equal(r.statusCode, 503);
  assert.equal(json(r).error.code, "feature_disabled");
  assert.equal(h.calls.some((c) => has(c, "insert")), false);
});

test("create listing: server sets owner, campus and mode; client values are ignored", async () => {
  const h = await harness({ env: { ENABLE_MARKETPLACE_WRITES: "true" }, handler: (c) => campusRows(c) ?? (c.table === "listings" ? { data: { id: LISTING_ID } } : undefined) });
  const r = await h.app.inject({
    method: "POST", url: "/v1/listings", headers: { ...h.authz, "x-campus-id": CAMPUS_B },
    payload: { ...validListing, owner_id: "99999999-9999-4999-8999-999999999999", campus_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", status: "active" },
  });
  assert.equal(r.statusCode, 201);
  assert.deepEqual(json(r).data, { id: LISTING_ID, status: "draft" });
  const insert = h.calls.find((c) => c.table === "listings" && has(c, "insert"))!;
  const row = opArgs(insert, "insert")![0] as Record<string, unknown>;
  assert.equal(row.owner_id, USER_ID);
  assert.equal(row.campus_id, CAMPUS_B); // header selects among RLS-visible campuses
  assert.equal(row.mode, "sell");
  assert.equal("status" in row, false);
});

test("X-Campus-Id that RLS did not return falls back to the first campus", async () => {
  const h = await harness({ env: { ENABLE_MARKETPLACE_WRITES: "true" }, handler: (c) => campusRows(c) ?? (c.table === "listings" ? { data: { id: LISTING_ID } } : undefined) });
  await h.app.inject({ method: "POST", url: "/v1/listings", headers: { ...h.authz, "x-campus-id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }, payload: validListing });
  const row = opArgs(h.calls.find((c) => c.table === "listings" && has(c, "insert"))!, "insert")![0] as any;
  assert.equal(row.campus_id, CAMPUS_A);
});

test("no approved campus means 403, not an empty success", async () => {
  const h = await harness({ env: { ENABLE_MARKETPLACE_WRITES: "true" }, handler: (c) => (c.table === "campuses" ? { data: [] } : undefined) });
  const r = await h.app.inject({ method: "POST", url: "/v1/listings", headers: h.authz, payload: validListing });
  assert.equal(r.statusCode, 403);
});

test("listing validation rejects bad input with field details", async () => {
  const h = await harness({ env: { ENABLE_MARKETPLACE_WRITES: "true" }, handler: campusRows });
  for (const bad of [{ price_inr: 0 }, { price_inr: 1.5 }, { price_inr: 10_000_001 }, { title: "short" }, { item_condition: "broken" }, { category_slug: "Bad Slug" }]) {
    const r = await h.app.inject({ method: "POST", url: "/v1/listings", headers: h.authz, payload: { ...validListing, ...bad } });
    assert.equal(r.statusCode, 400, JSON.stringify(bad));
    assert.ok(json(r).error.details.length >= 1);
  }
});

test("browse listings: campus-scoped, active only, plain-text search, pagination hasMore", async () => {
  const rows = Array.from({ length: 19 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, title: "t" + i }));
  const h = await harness({ handler: (c) => campusRows(c) ?? (c.table === "listings" ? { data: rows } : { data: [] }) });
  const r = await h.app.inject({ url: "/v1/listings?q=calculus%20book&category=books-study&page=2", headers: h.authz });
  assert.equal(r.statusCode, 200);
  const body = json(r);
  assert.equal(body.data.length, 18);
  assert.deepEqual(body.page, { page: 2, limit: 18, hasMore: true });
  const q = h.calls.find((c) => c.table === "listings")!;
  assert.ok(has(q, "eq", "campus_id", CAMPUS_A) && has(q, "eq", "status", "active") && has(q, "eq", "category_slug", "books-study"));
  assert.deepEqual(opArgs(q, "textSearch"), ["search_document", "calculus book", { config: "simple", type: "plain" }]);
  assert.deepEqual(opArgs(q, "range"), [18, 36]);
  assert.equal((await h.app.inject({ url: "/v1/listings?page=0", headers: h.authz })).statusCode, 400);
  assert.equal((await h.app.inject({ url: "/v1/listings?limit=500", headers: h.authz })).statusCode, 400);
});

test("RPC-backed actions pass the exact argument names and map database errors safely", async () => {
  let fail: any = null;
  const h = await harness({ env: { ENABLE_MARKETPLACE_INTERACTIONS: "true", ENABLE_SALE_TRANSACTIONS: "true" }, handler: (c) => (c.kind === "rpc" ? (fail ? { error: fail } : { data: "33333333-3333-4333-8333-333333333333" }) : undefined) });
  const nonce = "44444444-4444-4444-8444-444444444444";
  let r = await h.app.inject({ method: "POST", url: `/v1/conversations/${LISTING_ID}/offers`, headers: h.authz, payload: { amount_inr: 500, nonce } });
  assert.equal(r.statusCode, 201);
  assert.deepEqual(h.calls.at(-1)!.args, { requested_conversation: LISTING_ID, requested_amount: 500, parent_offer: null, request_nonce: nonce });
  r = await h.app.inject({ method: "POST", url: `/v1/offers/${LISTING_ID}/transactions`, headers: h.authz });
  assert.deepEqual(json(r).data, { id: "33333333-3333-4333-8333-333333333333" });

  fail = { code: "PT429", message: "secret table detail" };
  r = await h.app.inject({ method: "POST", url: `/v1/conversations/${LISTING_ID}/messages`, headers: h.authz, payload: { body: "hello", nonce } });
  assert.equal(r.statusCode, 429);
  fail = { code: "XX000", message: "relation private.outbox_events failed at /var/lib/pg" };
  r = await h.app.inject({ method: "POST", url: `/v1/offers/${LISTING_ID}/resolve`, headers: h.authz, payload: { decision: "accept" } });
  assert.equal(r.statusCode, 409);
  assert.doesNotMatch(r.body, /private|outbox|pg/);
  fail = { code: "42501", message: "x" };
  r = await h.app.inject({ method: "POST", url: `/v1/offers/${LISTING_ID}/resolve`, headers: h.authz, payload: { decision: "accept" } });
  assert.equal(r.statusCode, 403);
  r = await h.app.inject({ method: "POST", url: `/v1/offers/${LISTING_ID}/resolve`, headers: h.authz, payload: { decision: "steal" } });
  assert.equal(r.statusCode, 400);
});

test("rental booking validates dates and requires an idempotency nonce", async () => {
  const h = await harness({ env: { ENABLE_RENTAL_OPERATIONS: "true" }, handler: (c) => (c.kind === "rpc" ? { data: LISTING_ID } : undefined) });
  const nonce = "44444444-4444-4444-8444-444444444444";
  const url = `/v1/rentals/${LISTING_ID}/bookings`;
  for (const bad of [{ start_date: "2026-02-30", return_date: "2026-03-05", nonce }, { start_date: "2026-03-05", return_date: "2026-03-05", nonce }, { start_date: "2026-03-01", return_date: "2026-03-05" }]) {
    assert.equal((await h.app.inject({ method: "POST", url, headers: h.authz, payload: bad })).statusCode, 400, JSON.stringify(bad));
  }
  const ok = await h.app.inject({ method: "POST", url, headers: h.authz, payload: { start_date: "2026-03-01", return_date: "2026-03-05", nonce } });
  assert.equal(ok.statusCode, 201);
  assert.deepEqual(h.calls.at(-1)!.args, { requested_rental: LISTING_ID, start_date: "2026-03-01", return_date: "2026-03-05", p_nonce: nonce });
});

test("photo upload: sniffs real type, stores under parent/uuid.ext, rolls back on registration failure", async () => {
  assert.equal(sniffImage(Buffer.from("not an image at all"))?.ext, undefined);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
  const h = await harness({ env: { ENABLE_MARKETPLACE_WRITES: "true" }, handler: (c) => (c.table === "listing_photos" && has(c, "select") ? { data: [{ position: 1 }, { position: 3 }] } : undefined) });
  let m = multipart(jpeg, "evil.png", "image/png"); // lies about its name/mime
  let r = await h.app.inject({ method: "POST", url: `/v1/listings/${LISTING_ID}/photos`, headers: { ...h.authz, ...m.headers }, payload: m.payload });
  assert.equal(r.statusCode, 201);
  assert.equal(json(r).data.position, 2);
  assert.match(h.uploads[0].p, new RegExp(`^${LISTING_ID}/[0-9a-f-]{36}\\.jpg$`));
  assert.equal(h.uploads[0].o.contentType, "image/jpeg");

  m = multipart(Buffer.from("<script>alert(1)</script>"), "a.jpg", "image/jpeg");
  r = await h.app.inject({ method: "POST", url: `/v1/listings/${LISTING_ID}/photos`, headers: { ...h.authz, ...m.headers }, payload: m.payload });
  assert.equal(r.statusCode, 415);
  assert.equal(h.uploads.length, 1);

  const h2 = await harness({ env: { ENABLE_MARKETPLACE_WRITES: "true" }, handler: (c) => (c.table === "listing_photos" ? (has(c, "insert") ? { error: { code: "42501" } } : { data: [] }) : undefined) });
  m = multipart(jpeg);
  r = await h2.app.inject({ method: "POST", url: `/v1/listings/${LISTING_ID}/photos`, headers: { ...h2.authz, ...m.headers }, payload: m.payload });
  assert.equal(r.statusCode, 403);
  assert.equal(h2.removed.length, 1, "orphaned object must be removed");

  const h3 = await harness({ env: { ENABLE_MARKETPLACE_WRITES: "true" }, handler: (c) => (c.table === "listing_photos" ? { data: [1, 2, 3, 4, 5].map((position) => ({ position })) } : undefined) });
  r = await h3.app.inject({ method: "POST", url: `/v1/listings/${LISTING_ID}/photos`, headers: { ...h3.authz, ...m.headers }, payload: m.payload });
  assert.equal(r.statusCode, 409);
  assert.equal(h3.uploads.length, 0);
});

test("oversized upload is rejected with 413", async () => {
  const h = await harness({ env: { ENABLE_MARKETPLACE_WRITES: "true" } });
  const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(5 * 1024 * 1024 + 10)]);
  const m = multipart(big);
  const r = await h.app.inject({ method: "POST", url: `/v1/listings/${LISTING_ID}/photos`, headers: { ...h.authz, ...m.headers }, payload: m.payload });
  assert.equal(r.statusCode, 413);
});

test("email OTP never reveals whether an account exists and is rate limited", async () => {
  let sent = 0;
  const h = await harness({ env: { AUTH_RATE_LIMIT_PER_MINUTE: "3" }, auth: { signInWithOtp: async () => { sent++; return { data: {}, error: { status: 422, message: "Signups not allowed" } }; } } });
  const post = () => h.app.inject({ method: "POST", url: "/v1/auth/otp", payload: { email: "Someone@Uni.edu" } });
  for (let i = 0; i < 3; i++) {
    const r = await post();
    assert.equal(r.statusCode, 202);
    assert.deepEqual(json(r), { data: { sent: true } });
  }
  assert.equal((await post()).statusCode, 429);
  assert.equal(sent, 3);
  const fresh = await harness();
  assert.equal((await fresh.app.inject({ method: "POST", url: "/v1/auth/otp", payload: { email: "not-an-email" } })).statusCode, 400);
});

test("verify returns a session for a valid code and 401 otherwise", async () => {
  const session = { access_token: "a", refresh_token: "r", expires_at: 123, expires_in: 3600, user: { id: USER_ID, email: "a@uni.edu" } };
  const h = await harness({ auth: { verifyOtp: async (p: any) => (p.token === "123456" ? { data: { session }, error: null } : { data: { session: null }, error: { message: "x" } }) } });
  let r = await h.app.inject({ method: "POST", url: "/v1/auth/verify", payload: { email: "a@uni.edu", token: "123456" } });
  assert.equal(r.statusCode, 200);
  assert.equal(json(r).data.access_token, "a");
  assert.equal(json(r).data.user.id, USER_ID);
  r = await h.app.inject({ method: "POST", url: "/v1/auth/verify", payload: { email: "a@uni.edu", token: "000000" } });
  assert.equal(r.statusCode, 401);
  r = await h.app.inject({ method: "POST", url: "/v1/auth/verify", payload: { email: "a@uni.edu", token: "12ab56" } });
  assert.equal(r.statusCode, 400);
});

test("profile update requires the row back (RLS-filtered updates are not success)", async () => {
  let row: unknown = null;
  const h = await harness({ env: { ENABLE_MARKETPLACE_USER_ACTIONS: "true" }, handler: (c) => (c.table === "profiles" ? { data: row } : undefined) });
  const patch = (name: string) => h.app.inject({ method: "PATCH", url: "/v1/me", headers: h.authz, payload: { display_name: name } });
  assert.equal((await patch("Asha  Rao")).statusCode, 404);
  row = { id: USER_ID, display_name: "Asha Rao" };
  const ok = await patch("  Asha   Rao ");
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(opArgs(h.calls.filter((c) => c.table === "profiles").at(-1)!, "update"), [{ display_name: "Asha Rao" }]);
  assert.equal((await patch("A")).statusCode, 400);
  assert.equal((await patch("bad\u0007name")).statusCode, 400);
});

test("notifications expose a client-neutral target", async () => {
  const id = "55555555-5555-4555-8555-555555555555";
  const h = await harness({ handler: (c) => (c.table === "notifications" ? { data: [{ id, category: "offer", title: "New offer", link_path: `/inbox/${id}`, created_at: "t", read_at: null }], count: 4 } : undefined) });
  const r = await h.app.inject({ url: "/v1/notifications", headers: h.authz });
  assert.deepEqual(json(r).data[0].target, { type: "conversation", id });
  assert.equal(json(r).unread_count, 4);
});

test("moderation queue: 25 rows means another page; non-moderators get 403 from Postgres", async () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({ report_id: i }));
  let deny = false;
  const h = await harness({ env: { ENABLE_MARKETPLACE_USER_ACTIONS: "true" }, handler: (c) => (c.kind === "rpc" ? (deny ? { error: { code: "42501" } } : { data: rows }) : undefined) });
  let r = await h.app.inject({ url: "/v1/admin/reports?page=1", headers: h.authz });
  assert.equal(json(r).data.length, 24);
  assert.equal(json(r).page.hasMore, true);
  assert.deepEqual(h.calls.at(-1)!.args, { page_number: 1 });
  deny = true;
  r = await h.app.inject({ url: "/v1/admin/reports", headers: h.authz });
  assert.equal(r.statusCode, 403);
});

test("the JWT is forwarded only to the user-scoped client, never echoed back", async () => {
  const h = await harness({ handler: campusRows });
  const r = await h.app.inject({ url: "/v1/campuses", headers: h.authz });
  assert.equal(r.statusCode, 200);
  assert.equal(json(r).active_campus_id, CAMPUS_A);
  assert.equal(r.body.includes(TOKEN), false);
});

test("rate limit applies globally", async () => {
  const h = await harness({ env: { RATE_LIMIT_PER_MINUTE: "5" } });
  const codes: number[] = [];
  for (let i = 0; i < 7; i++) codes.push((await h.app.inject({ url: "/v1/me" })).statusCode);
  assert.deepEqual(codes.slice(0, 5), [401, 401, 401, 401, 401]);
  assert.equal(codes[6], 429);
});
