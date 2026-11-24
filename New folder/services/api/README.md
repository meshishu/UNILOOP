# UNILOOP API

A standalone REST API (Fastify + TypeScript) for UNILOOP, usable by the web app,
a mobile app, or scripts. It sits **beside** Supabase and reuses the existing
schema, RPCs, Storage buckets and Auth in `supabase/migrations`.

## Why it sits beside Supabase instead of replacing it

The database already enforces the hard rules: RLS, campus eligibility, offer and
rental state machines, the rental exclusion constraint, write budgets and the
notification outbox. This API runs **every request as the signed-in user** (their
JWT is forwarded to PostgREST and Storage), so those rules keep applying and
cannot be bypassed by a bug in this service. It never holds a `service_role` key
and refuses to start if given one.

Replacing Supabase would mean re-implementing all of that authorization in code,
which is a much larger and riskier job. If you still want that, say so and it
becomes a separate project.

## Run

```bash
cp .env.example .env     # SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY (same as apps/web)
npm install
npm run dev              # or: npm start
npm test && npm run typecheck
```

Requires Node >= 22.18 (runs `.ts` directly; no build step). Docker: `docker build -t uniloop-api .`

Apply the repo's migrations to your Supabase project first. Never apply `supabase/tests`.

## Conventions

- **Auth:** `Authorization: Bearer <access_token>`. Verified against Supabase Auth on every
  request (revoked sessions stop working at once); email must be confirmed.
- **Campus:** a valid login is not marketplace access. `X-Campus-Id` selects among campuses RLS
  already allows; otherwise the first one is used. No approved campus gives `403`.
- **Responses:** `{ "data": ... }`, lists add `"page": { page, limit, hasMore }`
  (`?page=1..1000&limit=1..50`). Errors: `{ "error": { code, message, details? } }`.
  Database messages are never returned.
- **Idempotency:** message, offer, booking and date-block calls take a client-generated UUID
  `nonce`. Reuse it when retrying the same intent after a network failure.
- **Feature gates:** mutations return `503 feature_disabled` unless the matching `ENABLE_*` flag is
  `true` (same flags and defaults as `apps/web`). Gates are UX switches; RLS is the real boundary.
- **Photos:** `multipart/form-data`, one `file` field, JPEG/PNG/WebP, max 5 MB, 5 per item. The type
  is detected from the bytes, not the filename or declared MIME. Image URLs in responses are
  signed and expire after 120 s.

## Endpoints (`/v1`)

| Area | Endpoints |
| --- | --- |
| Auth | `POST /auth/otp` `POST /auth/verify` `POST /auth/refresh` `POST /auth/logout` |
| Account | `GET /me` `PATCH /me` `PUT /me/notification-preferences` `GET /me/favorites` |
| Catalog | `GET /categories` `GET /campuses` |
| Sale listings | `GET /listings` (`q`, `category`) `GET /listings/mine` `POST /listings` `GET /listings/:id` `POST /listings/:id/status` `POST /listings/:id/photos` `PUT/DELETE /listings/:id/favorite` `POST /listings/:id/reports` |
| Conversations | `POST /listings/:id/conversations` `GET /conversations` `GET /conversations/:id` `POST /conversations/:id/messages` `POST /conversations/:id/offers` `POST /offers/:id/resolve` `PUT/DELETE /users/:id/block` |
| Sale handover | `POST /offers/:id/transactions` `GET /transactions` `GET /transactions/:id` `POST /transactions/:id/confirm` `POST /transactions/:id/review` |
| Rentals | `GET /rentals` `GET /rentals/mine` `POST /rentals` `GET /rentals/:id` `POST /rentals/:id/status` `POST /rentals/:id/photos` `POST /rentals/:id/blocks` `POST /rentals/:id/bookings` |
| Bookings | `GET /bookings` `GET /bookings/:id` `POST /bookings/:id/decision` `POST /bookings/:id/notes` |
| Notifications | `GET /notifications` `POST /notifications/read` |
| Moderation | `GET /admin/reports` `POST /admin/reports/:id/review` (Postgres decides who is a moderator) |
| Ops (unversioned) | `GET /healthz` `GET /readyz` |

### Email-code login

`/auth/otp` always answers `202` (no account enumeration). For app clients, add
`{{ .Token }}` to the Supabase "Magic Link" email template so users receive a 6-8 digit
code, then call `/auth/verify` with `{ email, token }`. A magic-link `token_hash` is also accepted.
`intent: "signup"` creates the identity only; campus approval still gates everything.

## Operating notes

- Rate limits are per IP and kept in process memory: fine for one instance. For several instances
  use a shared store (see `@fastify/rate-limit` Redis option). Set `TRUST_PROXY_HOPS` behind a proxy.
- The notification outbox worker and `/api/jobs/*` endpoints stay in `apps/web`; this service does
  not duplicate them.
- No realtime endpoint: poll `GET /conversations/:id`, or subscribe with Supabase Realtime directly.
- There is no payment handling, same as the rest of UNILOOP.

## Verification status

Covered by `npm test` (21 tests, fake Supabase client): auth and email confirmation, gates, server-set
owner/campus, validation, RPC argument names, safe error mapping, upload type sniffing and orphan
rollback, rate limits, config guard.

**Not verified:** anything against a real Supabase project (Auth, Storage, RLS, RPC behaviour). Run
the same staging checks the web app requires before turning on any `ENABLE_*` flag.
