import type { SupabaseClient } from "@supabase/supabase-js";
import { loadConfig, type Config } from "../src/config.ts";
import type { Deps } from "../src/deps.ts";
import { buildApp } from "../src/app.ts";

export const USER_ID = "11111111-1111-4111-8111-111111111111";
export const CAMPUS_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const CAMPUS_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const TOKEN = "tok_" + "x".repeat(40);
export const LISTING_ID = "22222222-2222-4222-8222-222222222222";

export type Call = { kind: "query" | "rpc"; table?: string; fn?: string; args?: any; ops: [string, unknown[]][] };
export type Result = { data?: unknown; error?: { code?: string; message?: string } | null; count?: number };
export type Handler = (call: Call) => Result | undefined;

export const has = (c: Call, op: string, ...args: unknown[]) =>
  c.ops.some(([n, a]) => n === op && args.every((v, i) => JSON.stringify(a[i]) === JSON.stringify(v)));
export const opArgs = (c: Call, op: string) => c.ops.find(([n]) => n === op)?.[1];

/** Chainable, awaitable stand-in for a supabase-js query builder. */
export function fakeClient(handler: Handler, calls: Call[] = [], storage: any = {}): SupabaseClient {
  const run = (call: Call) => {
    calls.push(call);
    const r = handler(call) ?? { data: null, error: null };
    return { data: r.data ?? null, error: r.error ?? null, count: r.count };
  };
  const builder = (call: Call): any =>
    new Proxy(function () {}, {
      get(_t, prop: string) {
        if (prop === "then") return (res: any, rej: any) => Promise.resolve(run(call)).then(res, rej);
        return (...args: unknown[]) => { call.ops.push([prop, args]); return builder(call); };
      },
    });
  const client: any = {
    from: (table: string) => builder({ kind: "query", table, ops: [] }),
    rpc: (fn: string, args: unknown) => builder({ kind: "rpc", fn, args, ops: [] }),
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, body: unknown, opts: unknown) => storage.upload?.(bucket, path, body, opts) ?? { data: { path }, error: null },
        remove: async (paths: string[]) => storage.remove?.(bucket, paths) ?? { data: [], error: null },
        createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: "https://signed.test/" + p, error: null })), error: null }),
      }),
    },
  };
  return client as SupabaseClient;
}

export type Harness = Awaited<ReturnType<typeof harness>>;

export async function harness(opts: {
  env?: Record<string, string>;
  handler?: Handler;
  user?: { email_confirmed_at?: string | null } | null;
  auth?: Partial<Record<"signInWithOtp" | "verifyOtp" | "refreshSession", any>>;
} = {}) {
  const calls: Call[] = [];
  const uploads: any[] = [];
  const removed: any[] = [];
  const config: Config = loadConfig({
    SUPABASE_URL: "https://proj.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_" + "k".repeat(30),
    NODE_ENV: "test",
    ...opts.env,
  });
  const userClient = fakeClient(opts.handler ?? (() => undefined), calls, {
    upload: (b: string, p: string, body: Buffer, o: any) => { uploads.push({ b, p, body, o }); return { data: { path: p }, error: null }; },
    remove: (b: string, p: string[]) => { removed.push({ b, p }); return { data: [], error: null }; },
  });
  const anon: any = {
    auth: {
      getUser: async (token: string) =>
        token === TOKEN && opts.user !== null
          ? { data: { user: { id: USER_ID, email: "a@uni.edu", email_confirmed_at: opts.user?.email_confirmed_at === undefined ? "2026-01-01" : opts.user.email_confirmed_at } }, error: null }
          : { data: { user: null }, error: { message: "bad jwt" } },
      signInWithOtp: opts.auth?.signInWithOtp ?? (async () => ({ data: {}, error: null })),
      verifyOtp: opts.auth?.verifyOtp ?? (async () => ({ data: { session: null }, error: { message: "bad" } })),
      refreshSession: opts.auth?.refreshSession ?? (async () => ({ data: { session: null }, error: { message: "bad" } })),
    },
  };
  const deps: Deps = { anon: () => anon, user: () => userClient, signOut: async () => true, ping: async () => true };
  const app = await buildApp(config, deps, { logger: false });
  const authz = { authorization: "Bearer " + TOKEN };
  return { app, calls, uploads, removed, authz, config };
}

/** Campus lookup answer used by most authenticated tests. */
export const campusRows: Handler = (c) =>
  c.table === "campuses" ? { data: [{ id: CAMPUS_A, name: "A" }, { id: CAMPUS_B, name: "B" }] } : undefined;

export function multipart(file: Buffer, filename = "x.jpg", mime = "image/jpeg") {
  const boundary = "----uniloopTest";
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, file, tail]), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}
